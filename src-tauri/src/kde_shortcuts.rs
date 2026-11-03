//! Desktop-wide shortcuts on Plasma.
//!
//! Plasma keeps global shortcuts inside its shortcut service, keyed by the
//! desktop entry's action names. The settings page edits those same bindings
//! with the same call System Settings uses, so both front-ends are looking at
//! one store instead of two lists that drift apart.
//!
//! Every request carries the four-part action id the service expects. A shorter
//! id is rejected by the lookup, and the paths that register a component index
//! all four fields without bounds checks, so the shape is not negotiable.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use zbus::blocking::Connection;

const SERVICE: &str = "org.kde.kglobalaccel";
const PATH: &str = "/kglobalaccel";
const IFACE: &str = "org.kde.KGlobalAccel";
const COMPONENT: &str = "sniplex.desktop";
const FRIENDLY_COMPONENT: &str = "Sniplex";

/// Flags the service understands for a shortcut write: the action is active,
/// and the keys we send replace the stored ones instead of being ignored in
/// favour of an existing binding.
const SET_PRESENT: u32 = 0x2;
const NO_AUTOLOADING: u32 = 0x4;

/// Interface id, desktop action, and the name the desktop shows for it.
const ACTIONS: [(&str, &str, &str); 4] = [
    ("overlay", "Capture", "Capture region"),
    ("fullscreen", "CaptureFullscreen", "Capture entire screen"),
    ("record", "CaptureRecord", "Start screen recording"),
    ("newCapture", "NewCapture", "New capture"),
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Binding {
    pub id: String,
    /// Qt key codes in the order the desktop stores them. An empty list means
    /// the action has no shortcut.
    pub codes: Vec<i32>,
}

fn action(id: &str) -> Option<(&'static str, &'static str)> {
    ACTIONS
        .iter()
        .find(|(app_id, _, _)| *app_id == id)
        .map(|(_, action, friendly)| (*action, *friendly))
}

fn action_id(action: &str, friendly: &str) -> Vec<String> {
    vec![
        COMPONENT.to_string(),
        action.to_string(),
        FRIENDLY_COMPONENT.to_string(),
        friendly.to_string(),
    ]
}

/// Reads the bindings the desktop currently holds for this entry.
///
/// `None` means the desktop does not keep shortcuts in a desktop entry, so the
/// caller should leave its own in-app bindings alone.
pub fn list() -> Result<Option<Vec<Binding>>, String> {
    if !super::global_shortcuts::desktop_owns_shortcuts() {
        return Ok(None);
    }

    let connection = Connection::session().map_err(|error| error.to_string())?;
    let bindings = read_all(&connection)?;

    // Nothing bound anywhere means the entry has not been registered yet, which
    // happens until the first login after installing. Reporting success there
    // would show the user an empty shortcut list.
    if bindings.iter().all(|binding| binding.codes.is_empty()) {
        return Err("The desktop has not registered Sniplex yet".to_string());
    }

    Ok(Some(bindings))
}

fn read_all(connection: &Connection) -> Result<Vec<Binding>, String> {
    let mut bindings = Vec::with_capacity(ACTIONS.len());

    for (id, action, friendly) in ACTIONS {
        let codes = read(connection, action, friendly)?;
        bindings.push(Binding {
            id: id.to_string(),
            codes,
        });
    }

    Ok(bindings)
}

/// Reads every shortcut the desktop stores for one action. A zeroed chord is
/// empty, so those slots and sequences are discarded.
fn read_sequences(
    connection: &Connection,
    action: &str,
    friendly: &str,
) -> Result<Vec<Vec<i32>>, String> {
    let reply = connection
        .call_method(
            Some(SERVICE),
            PATH,
            Some(IFACE),
            "shortcutKeys",
            &(action_id(action, friendly),),
        )
        .map_err(|error| error.to_string())?;

    let sequences: Vec<(Vec<i32>,)> = reply
        .body()
        .deserialize()
        .map_err(|error| error.to_string())?;

    Ok(sequences
        .into_iter()
        .map(|(sequence,)| used_codes(&sequence))
        .filter(|sequence| !sequence.is_empty())
        .collect())
}

fn read(connection: &Connection, action: &str, friendly: &str) -> Result<Vec<i32>, String> {
    Ok(read_sequences(connection, action, friendly)?
        .into_iter()
        .next()
        .unwrap_or_default())
}

/// Replaces the complete Sniplex shortcut set, keeping the desktop consistent.
///
/// Before writing, every desired binding is checked against keys held by other
/// applications. Empty bindings are applied first so a key that moves within
/// Sniplex becomes available. If any step fails, the previously applied actions
/// are written back in reverse order, so the whole edit either takes effect or
/// the desktop returns to the exact bindings it had before it started.
pub fn set_all(desired: Vec<Binding>) -> Result<Vec<Binding>, String> {
    if !super::global_shortcuts::desktop_owns_shortcuts() {
        return Err("This desktop does not keep shortcuts in a desktop entry".to_string());
    }

    let mut desired_by_id = HashMap::new();
    let mut seen_codes = HashSet::new();

    for binding in desired {
        if action(&binding.id).is_none() {
            return Err("Unknown shortcut".to_string());
        }

        for code in &binding.codes {
            if !seen_codes.insert(*code) {
                return Err("The same key is assigned to more than one shortcut".to_string());
            }
        }

        if desired_by_id.insert(binding.id.clone(), binding).is_some() {
            return Err("Each shortcut must be assigned once".to_string());
        }
    }

    if desired_by_id.len() != ACTIONS.len() {
        return Err("Each shortcut must be listed once".to_string());
    }

    let connection = Connection::session().map_err(|error| error.to_string())?;
    let snapshot = read_all(&connection)?;
    let snapshot_by_id: HashMap<&str, &Binding> = snapshot
        .iter()
        .map(|binding| (binding.id.as_str(), binding))
        .collect();

    // Nothing is written until every requested key has been checked.
    for (id, _, _) in ACTIONS {
        for code in &desired_by_id[id].codes {
            if let Some(owner) = foreign_owner(&connection, *code)? {
                return Err(format!("{owner} already uses this key"));
            }
        }
    }

    let changed = ACTIONS
        .iter()
        .copied()
        .filter(|(id, _, _)| desired_by_id[*id].codes != snapshot_by_id[*id].codes)
        .collect::<Vec<_>>();

    // Every changed binding is cleared before any is made active. Source keys
    // are always released, so one Sniplex action can take over another's key.
    for (id, action_name, friendly) in &changed {
        if let Err(error) = set_one(&connection, id, action_name, friendly, &[]) {
            return Err(restore_or_report(
                &connection,
                &snapshot,
                &changed,
                format!("{id}: {error}"),
            ));
        }
    }

    for (id, action_name, friendly) in changed.iter() {
        let desired = &desired_by_id[*id];

        if desired.codes.is_empty() {
            continue;
        }

        if let Err(error) = set_one(&connection, id, action_name, friendly, &desired.codes) {
            return Err(restore_or_report(
                &connection,
                &snapshot,
                &changed,
                format!("{id}: {error}"),
            ));
        }
    }

    Ok(ACTIONS
        .iter()
        .map(|(id, _, _)| desired_by_id[*id].clone())
        .collect())
}

/// Restores the bindings that changed and reports whether it succeeded.
///
/// Changed bindings are cleared before restoring, so a key that moved within
/// Sniplex does not block its own restoration. When a full rollback fails, the
/// failure names the actions the caller must repair manually.
fn restore_or_report(
    connection: &Connection,
    snapshot: &[Binding],
    changed: &[(&'static str, &'static str, &'static str)],
    error: String,
) -> String {
    let snapshot_by_id: HashMap<&str, &Binding> = snapshot
        .iter()
        .map(|binding| (binding.id.as_str(), binding))
        .collect();
    let mut rollback_errors = Vec::new();

    for (id, action_name, friendly) in changed {
        if let Err(rollback_error) = set_one(connection, id, action_name, friendly, &[]) {
            rollback_errors.push(format!("{id} clear: {rollback_error}"));
        }
    }

    for (id, action_name, friendly) in changed {
        let previous = snapshot_by_id[*id];

        if let Err(rollback_error) =
            set_one(connection, id, action_name, friendly, &previous.codes)
        {
            rollback_errors.push(format!("{id}: {rollback_error}"));
        }
    }

    if rollback_errors.is_empty() {
        return format!("{error}; previous shortcuts were restored");
    }

    format!(
        "{error}; previous shortcuts could not be fully restored: {}",
        rollback_errors.join(", ")
    )
}

/// Writes one binding without ownership checks. Batch validation is done first
/// so no binding is reassigned while one part of the edit would be refused.
fn set_one(
    connection: &Connection,
    id: &str,
    action_name: &str,
    friendly_name: &str,
    codes: &[i32],
) -> Result<Vec<i32>, String> {
    action(id).ok_or_else(|| "Unknown shortcut".to_string())?;

    let sequences = if codes.is_empty() {
        Vec::new()
    } else {
        // The service reads a key sequence as four fixed slots, one per chord.
        let mut sequence = vec![0; 4];
        for (index, code) in codes.iter().take(4).enumerate() {
            sequence[index] = *code;
        }
        vec![(sequence,)]
    };

    let reply = connection
        .call_method(
            Some(SERVICE),
            PATH,
            Some(IFACE),
            "setShortcutKeys",
            &(
                action_id(action_name, friendly_name),
                sequences,
                SET_PRESENT | NO_AUTOLOADING,
            ),
        )
        .map_err(|error| error.to_string())?;

    let applied: Vec<(Vec<i32>,)> = reply
        .body()
        .deserialize()
        .map_err(|error| error.to_string())?;

    Ok(applied
        .first()
        .map(|(sequence,)| used_codes(sequence))
        .unwrap_or_default())
}

/// Name of another application holding this key, if any. Sniplex's own bindings
/// do not count, otherwise moving a shortcut within the app would be refused.
fn foreign_owner(connection: &Connection, code: i32) -> Result<Option<String>, String> {
    let reply = connection
        .call_method(
            Some(SERVICE),
            PATH,
            Some(IFACE),
            "getGlobalShortcutsByKey",
            &(code,),
        )
        .map_err(|error| error.to_string())?;

    type Owner = (String, String, String, String, String, String, Vec<i32>, Vec<i32>);
    let owners: Vec<Owner> = reply
        .body()
        .deserialize()
        .map_err(|error| error.to_string())?;

    for (_, _, component, friendly, _, _, _, _) in owners {
        if component != COMPONENT {
            return Ok(Some(if friendly.is_empty() {
                component
            } else {
                friendly
            }));
        }
    }

    Ok(None)
}

fn used_codes(sequence: &[i32]) -> Vec<i32> {
    sequence.iter().copied().filter(|code| *code != 0).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Needs a running Plasma session; the plain test run skips it.
    fn plasma() -> bool {
        super::super::global_shortcuts::desktop_owns_shortcuts() && Connection::session().is_ok()
    }

    #[test]
    #[ignore = "needs a running Plasma session"]
    fn reads_the_bindings_the_desktop_holds() {
        if !plasma() {
            return;
        }

        let bindings = list().expect("list").expect("desktop entry owns shortcuts");
        assert_eq!(bindings.len(), ACTIONS.len());
        assert!(
            bindings.iter().any(|binding| !binding.codes.is_empty()),
            "at least one action should be bound"
        );
    }

    #[test]
    #[ignore = "needs a running Plasma session"]
    fn writes_all_bindings_back_unchanged() {
        if !plasma() {
            return;
        }

        let before = list().expect("list").expect("desktop entry owns shortcuts");
        let applied = set_all(before.clone()).expect("write");
        assert_eq!(applied, before);
    }

    #[test]
    #[ignore = "needs a running Plasma session"]
    fn applies_a_full_edit_and_restores_it() {
        if !plasma() {
            return;
        }

        let before = list().expect("list").expect("desktop entry owns shortcuts");
        let Some(code) = before
            .iter()
            .find(|binding| binding.id == "overlay")
            .and_then(|binding| binding.codes.first().copied())
        else {
            return;
        };

        let edited = before
            .iter()
            .map(|binding| match binding.id.as_str() {
                "overlay" => Binding { codes: Vec::new(), ..binding.clone() },
                "newCapture" => Binding { codes: vec![code], ..binding.clone() },
                _ => binding.clone(),
            })
            .collect::<Vec<_>>();

        let applied = set_all(edited).expect("apply");
        assert_eq!(
            applied
                .iter()
                .find(|binding| binding.id == "overlay")
                .map(|binding| binding.codes.clone()),
            Some(Vec::new())
        );

        set_all(before).expect("restore");
    }

    #[test]
    #[ignore = "needs a running Plasma session"]
    fn refuses_a_key_another_application_holds() {
        if !plasma() {
            return;
        }

        let before = list().expect("list").expect("desktop entry owns shortcuts");
        let desired = before
            .into_iter()
            .map(|mut binding| {
                if binding.id == "overlay" {
                    binding.codes = vec![0x01000009];
                }
                binding
            })
            .collect();

        // Print belongs to the desktop's own capture tool on a stock Plasma.
        let connection = Connection::session().unwrap();
        let Some(owner) = foreign_owner(&connection, 0x01000009).expect("owner lookup") else {
            return;
        };

        let error = set_all(desired).expect_err("should be refused");
        assert!(error.contains(&owner), "expected {error} to name {owner}");
    }
}
