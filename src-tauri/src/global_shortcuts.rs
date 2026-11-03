//! Capture shortcuts for desktops that do not read the desktop entry.
//!
//! Plasma takes global shortcuts from the desktop entry itself: the compositor
//! owns the keys, starts the programme when one is pressed, and keeps them
//! working while nothing is running. Registering them here as well would fight
//! the compositor for the same keys, so on Plasma this module does nothing.
//!
//! Desktops that instead implement the `GlobalShortcuts` portal ask the running
//! instance, which is the sanctioned mechanism there and what this module
//! registers.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use zbus::blocking::{Connection, MessageIterator, Proxy};
use zbus::message::Type as MessageType;
use zbus::zvariant::{ObjectPath, Value};
use zbus::MatchRule;

const EVENT: &str = "sniplex-global-shortcut";

const PORTAL_SERVICE: &str = "org.freedesktop.portal.Desktop";
const PORTAL_IFACE: &str = "org.freedesktop.portal.GlobalShortcuts";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const PORTAL_SESSION_IFACE: &str = "org.freedesktop.portal.Session";

/// Session token kept constant so the desktop reuses one shortcut set instead
/// of accumulating a new one on every launch.
const SESSION_TOKEN: &str = "shortcuts";

#[derive(Deserialize, Clone, Debug)]
pub struct ShortcutSpec {
    pub id: String,
    pub description: String,
    /// Trigger in the XDG shortcuts syntax, for example `CTRL+SHIFT+S`.
    pub trigger: String,
}

#[derive(Serialize, Clone)]
struct Activation {
    id: String,
}

struct ActiveSession {
    iface: &'static str,
    path: String,
}

struct Shared {
    connection: Connection,
    active: Mutex<Option<ActiveSession>>,
}

static SHARED: OnceLock<Shared> = OnceLock::new();
static LISTENER: OnceLock<()> = OnceLock::new();

/// Plasma owns the shortcut keys through the desktop entry. Requesting them
/// again here would compete with the compositor, so the portal is left alone.
pub(crate) fn desktop_owns_shortcuts() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP")
        .map(|value| value.to_ascii_uppercase().contains("KDE"))
        .unwrap_or(false)
}

pub fn sync(app: &AppHandle, specs: Vec<ShortcutSpec>) -> Result<(), String> {
    if desktop_owns_shortcuts() {
        return Ok(());
    }

    let shared = shared()?;
    start_listener(app.clone());

    let connection = &shared.connection;
    match portal_version(connection) {
        Some(version) if version >= 2 => {}
        Some(_) => return Err("This desktop cannot bind global shortcuts".to_string()),
        None => return Err("This desktop does not expose global shortcuts".to_string()),
    }

    close_active(connection, &shared);
    let session = bind_through_portal(connection, &specs)?;

    if let Ok(mut active) = shared.active.lock() {
        *active = Some(session);
    }
    Ok(())
}

fn shared() -> Result<&'static Shared, String> {
    if let Some(shared) = SHARED.get() {
        return Ok(shared);
    }

    let connection = Connection::session().map_err(|err| err.to_string())?;
    let _ = SHARED.set(Shared {
        connection,
        active: Mutex::new(None),
    });
    SHARED
        .get()
        .ok_or_else(|| "Shortcut service unavailable".to_string())
}

fn portal_version(connection: &Connection) -> Option<u32> {
    let proxy = Proxy::new(connection, PORTAL_SERVICE, PORTAL_PATH, PORTAL_IFACE).ok()?;
    proxy.get_property::<u32>("version").ok()
}

fn sender_prefix(connection: &Connection) -> String {
    connection
        .unique_name()
        .map(|name| name.to_string().trim_start_matches(':').replace('.', "_"))
        .unwrap_or_default()
}

fn close_active(connection: &Connection, shared: &Shared) {
    let previous = shared.active.lock().ok().and_then(|mut slot| slot.take());
    let Some(previous) = previous else { return };

    let _ = connection.call_method(
        Some(PORTAL_SERVICE),
        previous.path.as_str(),
        Some(previous.iface),
        "Close",
        &(),
    );
}

fn shortcut_entries(specs: &[ShortcutSpec]) -> Vec<(String, HashMap<String, Value<'static>>)> {
    specs
        .iter()
        .map(|spec| {
            let mut info: HashMap<String, Value<'static>> = HashMap::new();
            info.insert("description".to_string(), spec.description.clone().into());
            if !spec.trigger.is_empty() {
                info.insert("preferred_trigger".to_string(), spec.trigger.clone().into());
            }
            (spec.id.clone(), info)
        })
        .collect()
}

/// Create a session, then let the desktop bind the list.
fn bind_through_portal(
    connection: &Connection,
    specs: &[ShortcutSpec],
) -> Result<ActiveSession, String> {
    let sender = sender_prefix(connection);
    let stamp = unique_stamp();
    let session_token = format!("{SESSION_TOKEN}{stamp}");
    let session_path =
        format!("/org/freedesktop/portal/desktop/session/{sender}/{session_token}");

    let create_handle = format!("sniplexcreate{stamp}");
    let create_request =
        format!("/org/freedesktop/portal/desktop/request/{sender}/{create_handle}");
    let mut create_options: HashMap<String, Value<'static>> = HashMap::new();
    create_options.insert("handle_token".to_string(), create_handle.into());
    create_options.insert("session_handle_token".to_string(), session_token.into());
    request_and_wait(connection, &create_request, "CreateSession", &(create_options,))?;

    let bind_handle = format!("sniplexbind{stamp}");
    let bind_request = format!("/org/freedesktop/portal/desktop/request/{sender}/{bind_handle}");
    let mut bind_options: HashMap<String, Value<'static>> = HashMap::new();
    bind_options.insert("handle_token".to_string(), bind_handle.into());

    let session = ObjectPath::try_from(session_path.as_str()).map_err(|err| err.to_string())?;
    request_and_wait(
        connection,
        &bind_request,
        "BindShortcuts",
        &(session, shortcut_entries(specs), "", bind_options),
    )?;

    Ok(ActiveSession {
        iface: PORTAL_SESSION_IFACE,
        path: session_path,
    })
}

fn unique_stamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_micros().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

/// Calls a request-based portal method and waits for its response. The signal
/// subscription is set up first so a fast reply cannot be missed.
fn request_and_wait<B>(
    connection: &Connection,
    request_path: &str,
    method: &str,
    body: &B,
) -> Result<(), String>
where
    B: serde::Serialize + zbus::zvariant::Type,
{
    let request = Proxy::new(
        connection,
        PORTAL_SERVICE,
        request_path,
        "org.freedesktop.portal.Request",
    )
    .map_err(|err| err.to_string())?;
    let mut responses = request
        .receive_signal("Response")
        .map_err(|err| err.to_string())?;

    connection
        .call_method(
            Some(PORTAL_SERVICE),
            PORTAL_PATH,
            Some(PORTAL_IFACE),
            method,
            body,
        )
        .map_err(|err| err.to_string())?;

    let message = responses
        .next()
        .ok_or_else(|| "The desktop stopped responding".to_string())?;
    let payload = message.body();
    let (code, _results): (u32, HashMap<String, Value>) = payload
        .deserialize()
        .map_err(|err| err.to_string())?;

    match code {
        0 => Ok(()),
        1 => Err("Shortcut binding was cancelled".to_string()),
        other => Err(format!("The desktop refused the shortcuts (code {other})")),
    }
}

fn start_listener(app: AppHandle) {
    if LISTENER.set(()).is_err() {
        return;
    }

    std::thread::spawn(move || {
        let Ok(connection) = Connection::session() else {
            return;
        };
        let Ok(builder) = MatchRule::builder()
            .msg_type(MessageType::Signal)
            .member("Activated")
        else {
            return;
        };
        let Ok(messages) = MessageIterator::for_match_rule(builder.build(), &connection, Some(64))
        else {
            return;
        };

        for message in messages {
            let Ok(message) = message else { continue };
            let body = message.body();
            let Ok((session, id, _timestamp, _options)) =
                body.deserialize::<(ObjectPath, String, u64, HashMap<String, Value>)>()
            else {
                continue;
            };

            let is_current = SHARED
                .get()
                .and_then(|shared| shared.active.lock().ok())
                .and_then(|active| {
                    active
                        .as_ref()
                        .map(|active| active.path == session.as_str())
                })
                .unwrap_or(false);
            if !is_current {
                continue;
            }

            let _ = app.emit(EVENT, Activation { id });
        }
    });
}
