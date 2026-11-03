//! Native capture of the keyboard chord currently being recorded.
//!
//! WebKit does not report every modifier as part of a browser `KeyboardEvent`.
//! On Linux GTK receives the complete modifier mask from the keyboard driver,
//! so shortcuts such as Super+Shift+S can be recorded exactly as the user
//! presses them instead of appearing to be Shift+S.

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Value};
use tauri::{Runtime, WebviewWindow};

static RECORDING_SHORTCUT: AtomicBool = AtomicBool::new(false);

/// Toggles native capture. The value returned tells callers whether Linux
/// GTK capture is available to them.
#[tauri::command]
pub fn set_shortcut_recording(enabled: bool) -> bool {
    #[cfg(target_os = "linux")]
    {
        RECORDING_SHORTCUT.store(enabled, Ordering::Relaxed);
        enabled
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = enabled;
        false
    }
}

fn recording_shortcut() -> bool {
    RECORDING_SHORTCUT.load(Ordering::Relaxed)
}

#[cfg(target_os = "linux")]
pub fn attach<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.with_webview(|webview| {
        use gtk::prelude::*;

        let view = webview.inner();
        let callback_view = view.clone();

        view.connect_key_press_event(move |_view, event| {
            if !recording_shortcut() {
                return gtk::glib::Propagation::Proceed;
            }

            let modifiers = modifiers(event);
            let Some(key) = key_name(event.keyval()) else {
                return gtk::glib::Propagation::Proceed;
            };

            dispatch_key(&callback_view, json!({
                "key": key,
                "modifiers": modifiers,
            }));
            gtk::glib::Propagation::Stop
        });
    });
}

#[cfg(not(target_os = "linux"))]
pub fn attach<R: Runtime>(_window: &WebviewWindow<R>) {}

#[cfg(target_os = "linux")]
fn modifiers(event: &gtk::gdk::EventKey) -> Vec<&'static str> {
    let state = event.state();
    let mut modifiers = Vec::with_capacity(4);

    if state.contains(gtk::gdk::ModifierType::CONTROL_MASK) {
        modifiers.push("Ctrl");
    }
    if state.contains(gtk::gdk::ModifierType::SHIFT_MASK) {
        modifiers.push("Shift");
    }
    if state.contains(gtk::gdk::ModifierType::MOD1_MASK) {
        modifiers.push("Alt");
    }
    if state.contains(gtk::gdk::ModifierType::MOD4_MASK) {
        modifiers.push("Super");
    }

    modifiers
}

#[cfg(target_os = "linux")]
fn key_name(keyval: gtk::gdk::keys::Key) -> Option<String> {
    use gtk::gdk::keys::constants;

    if keyval == constants::Escape {
        return Some("Escape".into());
    } else if keyval == constants::Return {
        return Some("Enter".into());
    } else if keyval == constants::Tab {
        return Some("Tab".into());
    } else if keyval == constants::BackSpace {
        return Some("Backspace".into());
    } else if keyval == constants::Delete {
        return Some("Delete".into());
    } else if keyval == constants::Insert {
        return Some("Insert".into());
    } else if keyval == constants::Home {
        return Some("Home".into());
    } else if keyval == constants::End {
        return Some("End".into());
    } else if keyval == constants::Left {
        return Some("ArrowLeft".into());
    } else if keyval == constants::Right {
        return Some("ArrowRight".into());
    } else if keyval == constants::Up {
        return Some("ArrowUp".into());
    } else if keyval == constants::Down {
        return Some("ArrowDown".into());
    } else if keyval == constants::Page_Up {
        return Some("PageUp".into());
    } else if keyval == constants::Page_Down {
        return Some("PageDown".into());
    } else if keyval == constants::space {
        return Some("Space".into());
    } else if keyval == constants::Print {
        return Some("PrintScreen".into());
    } else if keyval == constants::F1 {
        return Some("F1".into());
    } else if keyval == constants::F2 {
        return Some("F2".into());
    } else if keyval == constants::F3 {
        return Some("F3".into());
    } else if keyval == constants::F4 {
        return Some("F4".into());
    } else if keyval == constants::F5 {
        return Some("F5".into());
    } else if keyval == constants::F6 {
        return Some("F6".into());
    } else if keyval == constants::F7 {
        return Some("F7".into());
    } else if keyval == constants::F8 {
        return Some("F8".into());
    } else if keyval == constants::F9 {
        return Some("F9".into());
    } else if keyval == constants::F10 {
        return Some("F10".into());
    } else if keyval == constants::F11 {
        return Some("F11".into());
    } else if keyval == constants::F12 {
        return Some("F12".into());
    } else if keyval == constants::Control_L || keyval == constants::Control_R {
        return Some("Control".into());
    } else if keyval == constants::Shift_L || keyval == constants::Shift_R {
        return Some("Shift".into());
    } else if keyval == constants::Alt_L || keyval == constants::Alt_R {
        return Some("Alt".into());
    } else if keyval == constants::Super_L || keyval == constants::Super_R {
        return Some("Super".into());
    }

    keyval.to_unicode().and_then(|character| {
        if character.is_control() {
            None
        } else {
            Some(character.to_uppercase().collect())
        }
    })
}

#[cfg(target_os = "linux")]
fn dispatch_key(view: &webkit2gtk::WebView, detail: Value) {
    use webkit2gtk::WebViewExt;

    let detail = detail.to_string();
    let script = format!(
        "window.dispatchEvent(new CustomEvent('sniplex-raw-key', {{ detail: {detail} }}));",
    );

    #[allow(deprecated)]
    view.run_javascript(&script, gtk::gio::Cancellable::NONE, |_| {});
}
