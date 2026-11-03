//! Launch-on-demand wiring for the desktop entry.
//!
//! The entry declares one action per capture mode and the compositor owns their
//! shortcuts, so pressing one starts this programme with `--capture=<mode>`.
//! A single well-known bus name keeps that to one live instance: the first
//! process owns the name, and every later launch hands its request over instead
//! of opening a second window.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use zbus::blocking::{Connection, MessageIterator};
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::message::Type as MessageType;
use zbus::MatchRule;

pub const BUS_NAME: &str = "org.sniplex.Sniplex";
const BUS_PATH: &str = "/org/sniplex/Sniplex";
const BUS_IFACE: &str = "org.sniplex.Sniplex";

/// Emitted when another launch asks this instance to capture.
pub const EVENT: &str = "sniplex-capture-request";

/// Capture modes the desktop entry can ask for.
const MODES: [&str; 4] = ["overlay", "record", "fullscreen", "new"];

/// Capture requested at launch, held until the interface is ready to run it.
pub struct LaunchState(pub Mutex<Option<String>>);

impl LaunchState {
    pub fn new(mode: Option<String>) -> Self {
        Self(Mutex::new(mode))
    }
}

fn normalise(value: &str) -> Option<String> {
    let value = value.trim().to_ascii_lowercase();
    MODES
        .iter()
        .find(|mode| **mode == value)
        .map(|mode| (*mode).to_string())
}

/// Reads the capture mode from the command line, if one was given.
/// Without it a plain launch behaves exactly as before.
pub fn requested_mode() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix("--capture=") {
            return normalise(value);
        }
        if arg == "--capture" {
            return args.next().as_deref().and_then(normalise);
        }
    }
    None
}

/// True when another instance already answers for this desktop entry. The
/// request is handed to it and this process stops before opening a window.
pub fn hand_off(mode: &Option<String>) -> bool {
    let Ok(connection) = Connection::session() else {
        return false;
    };
    if !name_taken(&connection) {
        return false;
    }

    forward(&connection, mode.as_deref()).is_ok()
}

fn name_taken(connection: &Connection) -> bool {
    connection
        .call_method(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            Some("org.freedesktop.DBus"),
            "NameHasOwner",
            &(BUS_NAME,),
        )
        .ok()
        .and_then(|reply| reply.body().deserialize::<bool>().ok())
        .unwrap_or(false)
}

fn forward(connection: &Connection, mode: Option<&str>) -> zbus::Result<()> {
    match mode {
        Some(mode) => {
            connection.call_method(
                Some(BUS_NAME),
                BUS_PATH,
                Some(BUS_IFACE),
                "Capture",
                &(mode,),
            )?;
        }
        None => {
            connection.call_method(Some(BUS_NAME), BUS_PATH, Some(BUS_IFACE), "Show", &())?;
        }
    }
    Ok(())
}

/// Claims the bus name and answers capture requests. When another instance won
/// a simultaneous start, this launch is forwarded there and the window closes.
pub fn serve(app: &AppHandle) {
    let Ok(connection) = Connection::session() else {
        return;
    };

    let owned = matches!(
        connection.request_name_with_flags(BUS_NAME, RequestNameFlags::DoNotQueue.into()),
        Ok(RequestNameReply::PrimaryOwner) | Ok(RequestNameReply::AlreadyOwner)
    );

    if !owned {
        let pending = app.state::<LaunchState>().0.lock().ok().and_then(|slot| slot.clone());
        let _ = forward(&connection, pending.as_deref());
        app.exit(0);
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || listen(connection, app));
}

fn listen(connection: Connection, app: AppHandle) {
    let Ok(builder) = MatchRule::builder()
        .msg_type(MessageType::MethodCall)
        .interface(BUS_IFACE)
    else {
        return;
    };
    let Ok(messages) = MessageIterator::for_match_rule(builder.build(), &connection, Some(16))
    else {
        return;
    };

    for message in messages {
        let Ok(message) = message else { continue };
        let member = message
            .header()
            .member()
            .map(|member| member.to_string())
            .unwrap_or_default();

        match member.as_str() {
            "Capture" => {
                if let Ok((mode,)) = message.body().deserialize::<(String,)>() {
                    request(&app, &mode);
                }
            }
            "Show" => show(&app),
            _ => {}
        }

        let _ = connection.reply(&message.header(), &());
    }
}

/// Records the request and lets the interface pick it up. The desktop may
/// activate a fresh process, so the request is kept until it is taken rather
/// than emitted only once and lost before the interface exists.
fn request(app: &AppHandle, mode: &str) {
    let Some(mode) = normalise(mode) else { return };
    if let Ok(mut slot) = app.state::<LaunchState>().0.lock() {
        *slot = Some(mode);
    }
    let _ = app.emit(EVENT, ());
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
