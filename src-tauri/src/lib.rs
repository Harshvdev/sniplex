use base64::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager, WebviewUrl};
use zbus::blocking::Connection;
use zbus::zvariant::Value;

mod capture_kwin;
mod global_shortcuts;
mod kde_shortcuts;
mod launcher;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct WindowRect {
    pub id: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DesktopCapture {
    pub image_data_url: String,
    pub width: u32,
    pub height: u32,
    pub windows: Vec<WindowRect>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CaptureSession {
    pub capture: DesktopCapture,
    pub mode: String,
    pub snip_type: String,
    pub delay: u32,
    /// Window that started the capture; it receives the finished snip.
    #[serde(default)]
    pub origin_label: Option<String>,
    #[serde(default)]
    pub include_cursor: bool,
}

#[derive(Default)]
pub struct AppCaptureState {
    pub session: std::sync::Mutex<Option<CaptureSession>>,
    pub frame_path: std::sync::Mutex<Option<std::path::PathBuf>>,
    pub frame_raw: std::sync::Mutex<Option<capture_kwin::RawFrame>>,
}

/// Payloads waiting for a dedicated capture window to pull them on mount.
#[derive(Default)]
pub struct CaptureWindowStore {
    pending: std::sync::Mutex<HashMap<String, serde_json::Value>>,
}

impl CaptureWindowStore {
    fn insert(&self, token: &str, payload: serde_json::Value) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(token.to_string(), payload);
        }
    }

    fn take(&self, token: &str) -> Option<serde_json::Value> {
        self.pending.lock().ok()?.remove(token)
    }
}

/// Fast in-memory RAM disk, falling back to the system temp directory.
fn temp_capture_dir() -> std::path::PathBuf {
    let shm_dir = std::path::Path::new("/dev/shm");
    if shm_dir.exists() && shm_dir.is_dir() {
        shm_dir.to_path_buf()
    } else {
        std::env::temp_dir()
    }
}

fn unique_capture_path(prefix: &str, extension: &str) -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    temp_capture_dir()
        .join(format!("sniplex-{}-{}.{}", prefix, timestamp, extension))
        .to_string_lossy()
        .to_string()
}

/// Removes capture buffers left behind by this or previous runs.
fn prune_capture_files() {
    let Ok(entries) = fs::read_dir(temp_capture_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("sniplex-frame-")
            || name.starts_with("sniplex-freeze-")
            || name.starts_with("sniplex_freeze_")
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn timing_log(marker: &str) {
    if std::env::var_os("SNIPLEX_TIMING").is_none() {
        return;
    }
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = temp_capture_dir().join("sniplex-timing.log");
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{} rust {}", timestamp, marker);
    }
}

/// Reads only the image header instead of the whole buffer.
fn read_capture_dimensions(path: &str) -> Option<(u32, u32, &'static str)> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 32];
    let read = file.read(&mut header).ok()?;
    parse_image_dimensions(&header[..read])
}

pub fn parse_image_dimensions(bytes: &[u8]) -> Option<(u32, u32, &'static str)> {
    if bytes.len() >= 24 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n" {
        let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        Some((width, height, "image/png"))
    } else if bytes.len() >= 26 && &bytes[0..2] == b"BM" {
        let width = u32::from_le_bytes([bytes[18], bytes[19], bytes[20], bytes[21]]);
        let height = u32::from_le_bytes([bytes[22], bytes[23], bytes[24], bytes[25]]);
        Some((width, height, "image/bmp"))
    } else {
        None
    }
}

pub fn parse_png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    parse_image_dimensions(bytes).map(|(w, h, _)| (w, h))
}

pub fn parse_kdotool_geometry(output: &str) -> Option<(i32, i32, u32, u32)> {
    let mut x = None;
    let mut y = None;
    let mut width = None;
    let mut height = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(pos_str) = trimmed.strip_prefix("Position:") {
            let pos_clean = pos_str.split('(').next().unwrap_or("").trim();
            let mut parts = pos_clean.split(',');
            if let (Some(x_str), Some(y_str)) = (parts.next(), parts.next()) {
                x = x_str.trim().parse::<i32>().ok();
                y = y_str.trim().parse::<i32>().ok();
            }
        } else if let Some(geo_str) = trimmed.strip_prefix("Geometry:") {
            let mut parts = geo_str.trim().split('x');
            if let (Some(w_str), Some(h_str)) = (parts.next(), parts.next()) {
                width = w_str.trim().parse::<u32>().ok();
                height = h_str.trim().parse::<u32>().ok();
            }
        }
    }

    match (x, y, width, height) {
        (Some(x), Some(y), Some(w), Some(h)) => Some((x, y, w, h)),
        _ => None,
    }
}

pub fn parse_wmctrl_line(line: &str) -> Option<WindowRect> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 7 {
        let id = parts[0].to_string();
        let x = parts[2].parse::<i32>().ok()?;
        let y = parts[3].parse::<i32>().ok()?;
        let width = parts[4].parse::<u32>().ok()?;
        let height = parts[5].parse::<u32>().ok()?;
        let title = parts[7..].join(" ");
        if width > 10 && height > 10 {
            return Some(WindowRect {
                id,
                title,
                x,
                y,
                width,
                height,
            });
        }
    }
    None
}

fn get_kwin_window_info(
    conn: &Connection,
    id: &str,
) -> Option<(String, i32, i32, u32, u32, bool, i32)> {
    let reply = conn
        .call_method(
            Some("org.kde.KWin"),
            "/KWin",
            Some("org.kde.KWin"),
            "getWindowInfo",
            &(id,),
        )
        .ok()?;
    let body = reply.body();
    let map: HashMap<String, zbus::zvariant::OwnedValue> = body.deserialize().ok()?;

    let caption = match map.get("caption") {
        Some(val) => match &**val {
            Value::Str(s) => s.to_string(),
            _ => String::new(),
        },
        None => String::new(),
    };
    let minimized = match map.get("minimized") {
        Some(val) => match &**val {
            Value::Bool(b) => *b,
            _ => false,
        },
        None => false,
    };
    let win_type = match map.get("type") {
        Some(val) => match &**val {
            Value::I32(i) => *i,
            Value::U32(u) => *u as i32,
            Value::F64(f) => *f as i32,
            _ => 0,
        },
        None => 0,
    };
    let width = match map.get("width") {
        Some(val) => match &**val {
            Value::F64(f) => f.round().max(0.0) as u32,
            Value::I32(i) => (*i).max(0) as u32,
            Value::U32(u) => *u,
            _ => 0,
        },
        None => 0,
    };
    let height = match map.get("height") {
        Some(val) => match &**val {
            Value::F64(f) => f.round().max(0.0) as u32,
            Value::I32(i) => (*i).max(0) as u32,
            Value::U32(u) => *u,
            _ => 0,
        },
        None => 0,
    };
    let x = match map.get("x") {
        Some(val) => match &**val {
            Value::F64(f) => f.round() as i32,
            Value::I32(i) => *i,
            Value::U32(u) => *u as i32,
            _ => 0,
        },
        None => 0,
    };
    let y = match map.get("y") {
        Some(val) => match &**val {
            Value::F64(f) => f.round() as i32,
            Value::I32(i) => *i,
            Value::U32(u) => *u as i32,
            _ => 0,
        },
        None => 0,
    };

    Some((caption, x, y, width, height, minimized, win_type))
}

pub fn detect_desktop_windows() -> (Vec<WindowRect>, Option<(u32, u32)>) {
    let mut windows = Vec::new();
    let mut desktop_bounds: Option<(u32, u32)> = None;
    let mut active_window_id: Option<String> = None;

    if let Ok(active_out) = Command::new("kdotool").arg("getactivewindow").output() {
        if active_out.status.success() {
            let id = String::from_utf8_lossy(&active_out.stdout).trim().to_string();
            if !id.is_empty() {
                active_window_id = Some(id);
            }
        }
    }

    // 1. Try KWin (KDE Wayland / X11)
    if let Ok(search_output) = Command::new("kdotool").args(["search", ""]).output() {
        if search_output.status.success() {
            let ids_str = String::from_utf8_lossy(&search_output.stdout);
            let conn = Connection::session().ok();

            for id in ids_str.lines() {
                let id = id.trim();
                if id.is_empty() {
                    continue;
                }

                if let Some(c) = &conn {
                    if let Some((title, x, y, width, height, minimized, win_type)) =
                        get_kwin_window_info(c, id)
                    {
                        if win_type == 1
                            || title.starts_with("Desktop @")
                            || title.starts_with("Desktop —")
                        {
                            if width > 0 && height > 0 {
                                desktop_bounds = Some((width, height));
                            }
                            continue;
                        }

                        // Exclude minimized windows, non-normal windows, desktop panels, and Sniplex
                        if minimized || win_type != 0 {
                            continue;
                        }

                        let trimmed_title = title.trim();
                        if trimmed_title.is_empty()
                            || trimmed_title == "Sniplex"
                            || trimmed_title.starts_with("Sniplex -")
                            || trimmed_title == "Plasma"
                        {
                            continue;
                        }

                        if width > 40 && height > 40 {
                            windows.push(WindowRect {
                                id: id.to_string(),
                                title,
                                x,
                                y,
                                width,
                                height,
                            });
                        }
                        continue;
                    }
                }

                // Fallback to kdotool subprocesses if D-Bus getWindowInfo was unavailable
                let mut title = String::new();
                if let Ok(name_out) = Command::new("kdotool").args(["getwindowname", id]).output() {
                    if name_out.status.success() {
                        title = String::from_utf8_lossy(&name_out.stdout).trim().to_string();
                    }
                }

                let trimmed_title = title.trim();
                if trimmed_title.starts_with("Desktop @") || trimmed_title.starts_with("Desktop —") {
                    if let Ok(geo_out) = Command::new("kdotool").args(["getwindowgeometry", id]).output() {
                        if geo_out.status.success() {
                            let geo_str = String::from_utf8_lossy(&geo_out.stdout);
                            if let Some((_, _, width, height)) = parse_kdotool_geometry(&geo_str) {
                                if width > 0 && height > 0 {
                                    desktop_bounds = Some((width, height));
                                }
                            }
                        }
                    }
                    continue;
                }

                if trimmed_title.is_empty()
                    || trimmed_title == "Sniplex"
                    || trimmed_title.starts_with("Sniplex -")
                    || trimmed_title == "Plasma"
                {
                    continue;
                }

                if let Ok(geo_out) = Command::new("kdotool").args(["getwindowgeometry", id]).output() {
                    if geo_out.status.success() {
                        let geo_str = String::from_utf8_lossy(&geo_out.stdout);
                        if let Some((x, y, width, height)) = parse_kdotool_geometry(&geo_str) {
                            if width > 40 && height > 40 {
                                windows.push(WindowRect {
                                    id: id.to_string(),
                                    title,
                                    x,
                                    y,
                                    width,
                                    height,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback to wmctrl (X11 / Xwayland) if no windows were retrieved
    if windows.is_empty() {
        if let Ok(wm_out) = Command::new("wmctrl").args(["-l", "-G"]).output() {
            if wm_out.status.success() {
                let list_str = String::from_utf8_lossy(&wm_out.stdout);
                for line in list_str.lines() {
                    if let Some(rect) = parse_wmctrl_line(line) {
                        let trimmed = rect.title.trim();
                        if trimmed != "Sniplex"
                            && !trimmed.starts_with("Sniplex -")
                            && !trimmed.starts_with("Desktop")
                        {
                            windows.push(rect);
                        }
                    }
                }
            }
        }
    }

    // Prioritize active window if known
    if let Some(active_id) = active_window_id {
        if let Some(pos) = windows.iter().position(|w| w.id == active_id) {
            let active_win = windows.remove(pos);
            windows.insert(0, active_win);
        }
    }

    (windows, desktop_bounds)
}

pub fn normalize_window_coordinates(
    windows: &mut [WindowRect],
    target_width: u32,
    target_height: u32,
    logical_bounds: Option<(u32, u32)>,
) {
    if target_width == 0 || target_height == 0 || windows.is_empty() {
        return;
    }

    let (max_w, max_h) = match logical_bounds {
        Some((lw, lh)) if lw > 0 && lh > 0 => (lw, lh),
        _ => {
            let mut mw = 0u32;
            let mut mh = 0u32;
            for w in windows.iter() {
                mw = mw.max((w.x.max(0) as u32).saturating_add(w.width));
                mh = mh.max((w.y.max(0) as u32).saturating_add(w.height));
            }
            if mw > 0 && mh > 0 {
                (mw, mh)
            } else {
                (target_width, target_height)
            }
        }
    };

    let scale_x = if max_w > 0 {
        target_width as f64 / max_w as f64
    } else {
        1.0
    };
    let scale_y = if max_h > 0 {
        target_height as f64 / max_h as f64
    } else {
        1.0
    };

    for w in windows.iter_mut() {
        let scaled_x = (w.x as f64 * scale_x).round() as i32;
        let scaled_y = (w.y as f64 * scale_y).round() as i32;
        let scaled_w = (w.width as f64 * scale_x).round() as u32;
        let scaled_h = (w.height as f64 * scale_y).round() as u32;

        let clamped_x = scaled_x.max(0).min(target_width.saturating_sub(1) as i32);
        let clamped_y = scaled_y.max(0).min(target_height.saturating_sub(1) as i32);
        let clamped_w = scaled_w.min(target_width.saturating_sub(clamped_x as u32)).max(1);
        let clamped_h = scaled_h.min(target_height.saturating_sub(clamped_y as u32)).max(1);

        w.x = clamped_x;
        w.y = clamped_y;
        w.width = clamped_w;
        w.height = clamped_h;
    }
}

/// Checks that the capture buffer is fully written (PNG IEND trailer or a
/// matching BMP byte count), so we never read a half-flushed file.
fn is_complete_image(path: &str) -> bool {
    use std::io::{Seek, SeekFrom};

    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let Ok(meta) = file.metadata() else {
        return false;
    };
    let len = meta.len();
    if len < 12 {
        return false;
    }

    let mut head = [0u8; 8];
    if file.read_exact(&mut head).is_err() {
        return false;
    }

    if &head == b"\x89PNG\r\n\x1a\n" {
        if file.seek(SeekFrom::End(-8)).is_err() {
            return false;
        }
        let mut tail = [0u8; 8];
        if file.read_exact(&mut tail).is_err() {
            return false;
        }
        return &tail == b"IEND\xae\x42\x60\x82";
    }

    if &head[0..2] == b"BM" {
        if file.seek(SeekFrom::Start(2)).is_err() {
            return false;
        }
        let mut size_buf = [0u8; 4];
        if file.read_exact(&mut size_buf).is_err() {
            return false;
        }
        return u32::from_le_bytes(size_buf) as u64 == len;
    }

    false
}

/// Waits until the capture tool has flushed a complete image, then stops it.
/// This avoids paying for the external tool's teardown (~100ms for spectacle).
fn run_capture_tool(command: &mut Command, output_path: &str) -> bool {
    let Ok(mut child) = command.spawn() else {
        return false;
    };

    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(3000);
    let mut captured = false;
    while std::time::Instant::now() < deadline {
        if is_complete_image(output_path) {
            captured = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(4));
    }

    let _ = child.kill();
    let _ = child.wait();
    captured
}

fn execute_screen_grab(output_path: &str, include_cursor: bool) -> bool {
    let desktop_env = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_uppercase();

    // 1. Try spectacle background capture (KDE Plasma)
    let mut spectacle = Command::new("spectacle");
    spectacle.args(["-b", "-n", "-o", output_path]);
    if include_cursor {
        spectacle.arg("-p");
    }
    if run_capture_tool(&mut spectacle, output_path) {
        return true;
    }

    // Fallback: try spectacle with explicit fullscreen flag
    let mut spectacle_full = Command::new("spectacle");
    spectacle_full.args(["-b", "-n", "-f", "-o", output_path]);
    if include_cursor {
        spectacle_full.arg("-p");
    }
    if run_capture_tool(&mut spectacle_full, output_path) {
        return true;
    }

    // 2. Try gnome-screenshot (GNOME on Wayland or X11; skip on KDE to avoid X11 assertion bugs)
    let mut gnome = Command::new("gnome-screenshot");
    gnome.args(["-f", output_path]);
    if include_cursor {
        gnome.arg("-p");
    }
    if !desktop_env.contains("KDE") && run_capture_tool(&mut gnome, output_path) {
        return true;
    }

    // 3. Try grim (wlroots-based Wayland compositors: Sway, Hyprland, Wayfire)
    let mut grim = Command::new("grim");
    if include_cursor {
        grim.arg("-c");
    }
    grim.arg(output_path);
    if run_capture_tool(&mut grim, output_path) {
        return true;
    }

    // 4. Try maim (X11)
    if run_capture_tool(Command::new("maim").arg(output_path), output_path) {
        return true;
    }

    // 5. Try scrot (X11)
    let mut scrot = Command::new("scrot");
    if include_cursor {
        scrot.arg("-p");
    }
    scrot.arg(output_path);
    if run_capture_tool(&mut scrot, output_path) {
        return true;
    }

    // 6. Try ImageMagick import (X11)
    if run_capture_tool(
        Command::new("import").args(["-window", "root", output_path]),
        output_path,
    ) {
        return true;
    }

    false
}

/// Loads the capture backend's libraries into the page cache once, at startup,
/// so the first snip does not pay for a cold interpreter/runtime start.
fn prewarm_capture_backend() {
    for tool in ["spectacle", "grim", "maim", "scrot"] {
        let Ok(mut child) = Command::new(tool)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        else {
            continue;
        };
        let _ = child.wait();
        return;
    }
}

/// True when the compositor can hand us pixels directly. Falls back to the
/// external capture tool when the session is not KDE, when the compositor
/// refused us before, or when SNIPLEX_CAPTURE=tool is set.
fn should_try_native_capture() -> bool {
    match std::env::var("SNIPLEX_CAPTURE").ok().as_deref() {
        Some("native") => return true,
        Some("tool") => return false,
        _ => {}
    }
    if capture_kwin::is_disabled() {
        return false;
    }
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_uppercase();
    desktop.contains("KDE")
}

/// Publishes the frozen frame for the overlay to pull over IPC.
fn publish_frame(state: &AppCaptureState, raw: Option<capture_kwin::RawFrame>, path: &str) {
    let has_raw = raw.is_some();
    if let Ok(mut slot) = state.frame_raw.lock() {
        *slot = raw;
    }
    if let Ok(mut slot) = state.frame_path.lock() {
        *slot = if has_raw {
            None
        } else {
            Some(std::path::PathBuf::from(path))
        };
    }
}

fn show_origin(app: &tauri::AppHandle, label: Option<&str>) {
    let target = label
        .and_then(|label| app.get_webview_window(label))
        .or_else(|| app.get_webview_window("main"));

    if let Some(window) = target {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Performs the blocking parts of a capture session off the UI thread.
fn run_capture_session(
    app: tauri::AppHandle,
    mode: String,
    snip_type: String,
    delay: u32,
    origin_label: Option<String>,
    include_cursor: bool,
) -> Result<(), String> {
    timing_log("capture_start");
    prune_capture_files();

    let frame_path = unique_capture_path("frame", "png");

    // Window geometry is collected in parallel and only needed for highlight
    // frames, so it must not delay the overlay reveal.
    let win_thread = std::thread::spawn(move || detect_desktop_windows());

    // Prefer the compositor: it returns raw pixels with no external process and
    // no image encoding at all.
    let mut native_frame = None;
    if should_try_native_capture() {
        // The compositor drops the editor window before the request is even
        // answered, so no settle delay is needed; the knob stays for setups
        // that turn out to need one.
        let settle = std::env::var("SNIPLEX_SETTLE_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
        if settle > 0 {
            std::thread::sleep(std::time::Duration::from_millis(settle));
        }
        timing_log("native_start");
        if let Ok(frame) = capture_kwin::capture_workspace(include_cursor) {
            native_frame = Some(frame);
        }
        timing_log("native_done");
    }

    let captured = match native_frame {
        Some(_) => true,
        None => {
            timing_log("tool_start");
            let result = execute_screen_grab(&frame_path, include_cursor);
            timing_log("tool_done");
            result
        }
    };
    timing_log("grab_done");

    if !captured {
        let _ = win_thread.join();
        show_origin(&app, origin_label.as_deref());
        return Err("Unable to capture screen using available desktop capture backends".to_string());
    }

    let (width, height) = match &native_frame {
        Some(frame) => (frame.width, frame.height),
        None => read_capture_dimensions(&frame_path)
            .map(|(width, height, _)| (width, height))
            .unwrap_or((1920, 1080)),
    };

    let state = app.state::<AppCaptureState>();
    publish_frame(&state, native_frame, &frame_path);

    // In Full-Screen mode, resolve instantly directly back into main window.
    // The frame is handed over without an image payload; the editor window pulls
    // it and re-encodes it once.
    if snip_type == "fullscreen" {
        let _ = win_thread.join();
        let payload = serde_json::json!({
            "imageUrl": "",
            "width": width,
            "height": height,
            "mode": "fullscreen"
        });
        let target = origin_label
            .as_deref()
            .and_then(|label| app.get_webview_window(label))
            .or_else(|| app.get_webview_window("main"));
        if let Some(window) = target {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("snip-captured", &payload);
        }
        return Ok(());
    }

    let (mut windows, desktop_bounds) = win_thread.join().unwrap_or_default();
    normalize_window_coordinates(&mut windows, width, height, desktop_bounds);
    timing_log("windows_detected");

    if let Ok(mut lock) = state.session.lock() {
        *lock = Some(CaptureSession {
            capture: DesktopCapture {
                image_data_url: String::new(),
                width,
                height,
                windows: windows.clone(),
            },
            mode,
            snip_type,
            delay,
            origin_label,
            include_cursor,
        });
    }

    // Notify overlay window that the frozen frame and session metadata are ready
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("session-ready", ());
        let _ = overlay.emit("windows-ready", &windows);
    }
    timing_log("session_sent");

    Ok(())
}

#[tauri::command]
async fn start_capture_session(
    app: tauri::AppHandle,
    mode: String,
    snip_type: String,
    delay: u32,
    origin_label: Option<String>,
    include_cursor: Option<bool>,
) -> Result<(), String> {
    timing_log("command_entry");
    let include_cursor = include_cursor.unwrap_or(false);

    // 1. Immediately hide the window that started the capture
    let origin = origin_label
        .as_deref()
        .and_then(|label| app.get_webview_window(label))
        .or_else(|| app.get_webview_window("main"));
    if let Some(window) = origin {
        let _ = window.hide();
    }

    // 2. Grab the display and overlay the desktop without blocking the UI thread
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_capture_session(app_handle, mode, snip_type, delay, origin_label, include_cursor)
    })
    .await
    .map_err(|e| format!("Capture task failed: {}", e))?
}

#[tauri::command]
fn get_capture_frame(
    state: tauri::State<'_, AppCaptureState>,
) -> Result<tauri::ipc::Response, String> {
    // Raw compositor frames travel as: magic "SLXR", width, height, then RGBA.
    let raw = state
        .frame_raw
        .lock()
        .ok()
        .and_then(|frame| frame.as_ref().map(|f| (f.width, f.height, f.data.clone())));
    if let Some((width, height, data)) = raw {
        let mut payload = Vec::with_capacity(12 + data.len());
        payload.extend_from_slice(b"SLXR");
        payload.extend_from_slice(&width.to_le_bytes());
        payload.extend_from_slice(&height.to_le_bytes());
        payload.extend_from_slice(&data);
        return Ok(tauri::ipc::Response::new(payload));
    }

    let path = state
        .frame_path
        .lock()
        .ok()
        .and_then(|frame| frame.clone())
        .ok_or_else(|| "No capture frame available".to_string())?;
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read capture frame: {}", e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Drops the session and its frozen frame buffer.
fn clear_capture_state(app: &tauri::AppHandle) {
    let state = app.state::<AppCaptureState>();
    if let Ok(mut lock) = state.session.lock() {
        *lock = None;
    }
    if let Ok(mut slot) = state.frame_raw.lock() {
        *slot = None;
    }
    let frame = state.frame_path.lock().ok().and_then(|mut frame| frame.take());
    if let Some(path) = frame {
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
fn get_capture_session(state: tauri::State<'_, AppCaptureState>) -> Result<Option<CaptureSession>, String> {
    if let Ok(lock) = state.session.lock() {
        Ok(lock.clone())
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn capture_desktop(app: tauri::AppHandle, include_cursor: Option<bool>) -> Result<DesktopCapture, String> {
    let include_cursor = include_cursor.unwrap_or(false);
    // 1. Immediately hide main editor window cleanly
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(25));

    // 2. Prepare fast in-memory RAM disk temp path (/dev/shm)
    let temp_path_str = unique_capture_path("freeze", "png");

    // Run screen grab and window detection in parallel across separate threads
    let thread_path = temp_path_str.to_string();
    let screen_thread =
        std::thread::spawn(move || execute_screen_grab(&thread_path, include_cursor));
    let win_thread = std::thread::spawn(move || detect_desktop_windows());

    let captured = screen_thread.join().unwrap_or(false);
    let (mut windows, desktop_bounds) = win_thread.join().unwrap_or_default();

    if !captured {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
        return Err("Unable to capture screen using available desktop capture backends".to_string());
    }

    let bytes = fs::read(&temp_path_str).map_err(|e| format!("Failed to read captured buffer: {}", e))?;
    let _ = fs::remove_file(&temp_path_str);

    let (width, height, mime) = parse_image_dimensions(&bytes).unwrap_or((1920, 1080, "image/png"));
    normalize_window_coordinates(&mut windows, width, height, desktop_bounds);
    let image_data_url = format!("data:{};base64,{}", mime, BASE64_STANDARD.encode(&bytes));

    Ok(DesktopCapture {
        image_data_url,
        width,
        height,
        windows,
    })
}

#[tauri::command]
fn show_capture_overlay(app: tauri::AppHandle) -> Result<(), String> {
    timing_log("show_call");
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.show();
        timing_log("show_returned");
        let _ = overlay.set_focus();
        timing_log("focus_returned");
    }
    Ok(())
}

#[tauri::command]
fn log_timing(line: String) {
    if std::env::var_os("SNIPLEX_TIMING").is_none() {
        return;
    }
    let path = temp_capture_dir().join("sniplex-timing.log");
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", line);
    }
}

#[tauri::command]
fn timing_enabled() -> bool {
    std::env::var_os("SNIPLEX_TIMING").is_some()
}

fn next_capture_token() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}", millis, count)
}

/// Opens a standalone editor window and parks its payload until the page asks
/// for it. The token in the fragment keeps each window's capture isolated.
fn spawn_capture_window(
    app: &tauri::AppHandle,
    payload: serde_json::Value,
) -> Result<(), String> {
    let token = next_capture_token();
    app.state::<CaptureWindowStore>()
        .insert(&token, payload.clone());

    let title = payload
        .get("title")
        .and_then(|value| value.as_str())
        .unwrap_or("Sniplex");

    build_capture_window(app, &token, title)
        .map(|_| ())
        .map_err(|err| format!("Failed to open capture window: {}", err))
}

fn build_capture_window(
    app: &tauri::AppHandle,
    token: &str,
    title: &str,
) -> tauri::Result<tauri::WebviewWindow> {
    tauri::WebviewWindowBuilder::new(
        app,
        format!("capture-{}", token),
        WebviewUrl::App(format!("index.html#capture={}", token).into()),
    )
    .title(title)
    .inner_size(1100.0, 720.0)
    .min_inner_size(700.0, 500.0)
    .decorations(false)
    .build()
}

#[tauri::command]
fn open_capture_window(
    app: tauri::AppHandle,
    payload: serde_json::Value,
) -> Result<(), String> {
    spawn_capture_window(&app, payload)
}

#[tauri::command]
fn take_capture_payload(
    store: tauri::State<'_, CaptureWindowStore>,
    token: String,
) -> Option<serde_json::Value> {
    store.take(&token)
}

#[tauri::command]
fn complete_capture(
    app: tauri::AppHandle,
    payload: serde_json::Value,
    open_in_new_window: Option<bool>,
) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }

    // The session remembers which editor started the capture, so a second
    // window (or a capture started while one is open) resolves to its origin.
    let origin_label = app
        .state::<AppCaptureState>()
        .session
        .lock()
        .ok()
        .and_then(|session| session.as_ref().and_then(|s| s.origin_label.clone()));

    clear_capture_state(&app);

    if open_in_new_window.unwrap_or(false) {
        show_origin(&app, origin_label.as_deref());
        return spawn_capture_window(&app, payload);
    }

    let target = origin_label
        .as_deref()
        .and_then(|label| app.get_webview_window(label))
        .or_else(|| app.get_webview_window("main"));

    if let Some(window) = target {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("snip-captured", payload);
    }
    Ok(())
}

#[tauri::command]
fn cancel_capture(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }

    let origin_label = app
        .state::<AppCaptureState>()
        .session
        .lock()
        .ok()
        .and_then(|session| session.as_ref().and_then(|s| s.origin_label.clone()));

    clear_capture_state(&app);
    show_origin(&app, origin_label.as_deref());
    Ok(())
}

#[tauri::command]
fn restore_window(window: tauri::Window, was_maximized: Option<bool>) -> Result<(), String> {
    let _ = window.set_fullscreen(false);
    std::thread::sleep(std::time::Duration::from_millis(100));

    if was_maximized.unwrap_or(true) {
        let _ = window.maximize();
    } else {
        let _ = window.unmaximize();
    }

    let _ = window.show();
    let _ = window.set_focus();

    Ok(())
}

#[tauri::command]
fn get_detected_windows(window: tauri::Window) -> Result<Vec<WindowRect>, String> {
    let (mut windows, desktop_bounds) = detect_desktop_windows();
    let size = window.inner_size().unwrap_or(tauri::PhysicalSize { width: 1920, height: 1080 });
    normalize_window_coordinates(&mut windows, size.width, size.height, desktop_bounds);
    Ok(windows)
}

fn decode_png_base64(encoded: &str) -> Result<Vec<u8>, String> {
    let bytes = BASE64_STANDARD
        .decode(encoded.trim())
        .map_err(|error| format!("Invalid clipboard image payload: {}", error))?;

    if bytes.len() < 8 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("Clipboard image payload is not a PNG".to_string());
    }

    Ok(bytes)
}

fn run_clipboard_writer(command: &mut Command, png: &[u8]) -> Result<(), String> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(png).map_err(|error| error.to_string())?;
    }

    let status = child.wait().map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("clipboard helper exited with {}", status))
    }
}

/// Publishes PNG bytes as a system clipboard image. Wayland uses wl-copy and
/// X11 uses xclip; both helpers fork to keep serving the selection.
fn write_png_to_clipboard(png: &[u8]) -> Result<String, String> {
    let mut failures = Vec::new();

    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        let mut command = Command::new("wl-copy");
        command.args(["--type", "image/png"]);
        match run_clipboard_writer(&mut command, png) {
            Ok(()) => return Ok("wayland".to_string()),
            Err(error) => failures.push(format!("wl-copy: {}", error)),
        }
    }

    if std::env::var_os("DISPLAY").is_some() {
        let mut command = Command::new("xclip");
        command.args(["-selection", "clipboard", "-t", "image/png"]);
        match run_clipboard_writer(&mut command, png) {
            Ok(()) => return Ok("x11".to_string()),
            Err(error) => failures.push(format!("xclip: {}", error)),
        }
    }

    if failures.is_empty() {
        Err("No system clipboard backend is available".to_string())
    } else {
        Err(format!(
            "Unable to copy the image to the system clipboard: {}",
            failures.join("; ")
        ))
    }
}

#[tauri::command]
fn copy_image_to_clipboard(png_base64: String) -> Result<String, String> {
    let png = decode_png_base64(&png_base64)?;
    write_png_to_clipboard(&png)
}

#[tauri::command]
fn select_folder() -> Result<Option<String>, String> {
    if let Ok(output) = Command::new("zenity")
        .args(["--file-selection", "--directory", "--title=Select Screenshots Folder"])
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(Some(path));
            }
        }
    } else if let Ok(output) = Command::new("kdialog")
        .args(["--getexistingdirectory"])
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(Some(path));
            }
        }
    }
    Ok(None)
}

/// Expands a leading `~` so preferences can store friendly folder paths.
fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home);
        }
    } else if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

#[tauri::command]
fn save_screenshot(folder: String, file_name: String, png_base64: String) -> Result<String, String> {
    let directory = expand_home(folder.trim());
    fs::create_dir_all(&directory).map_err(|error| {
        format!("Failed to create {}: {}", directory.display(), error)
    })?;

    // File names come from timestamped defaults, but never allow the name to
    // escape the chosen folder.
    let clean_name: String = file_name
        .chars()
        .filter(|character| *character != '/' && *character != '\\' && !character.is_control())
        .collect();
    let clean_name = if clean_name.trim().is_empty() {
        "Sniplex.png".to_string()
    } else {
        clean_name
    };

    let path = directory.join(clean_name);
    let bytes = decode_png_base64(&png_base64)?;
    fs::write(&path, &bytes)
        .map_err(|error| format!("Failed to write {}: {}", path.display(), error))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Hands the capture shortcuts to the desktop portal on desktops that do not
/// take them from the desktop entry. Runs off the UI thread because the portal
/// may ask the user to confirm the bindings.
#[tauri::command]
async fn sync_global_shortcuts(
    app: tauri::AppHandle,
    shortcuts: Vec<global_shortcuts::ShortcutSpec>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || global_shortcuts::sync(&app, shortcuts))
        .await
        .map_err(|error| error.to_string())?
}

/// Takes the capture another launch handed over, if there is one waiting.
#[tauri::command]
fn take_launch_action(state: tauri::State<'_, launcher::LaunchState>) -> Option<String> {
    state.0.lock().ok().and_then(|mut slot| slot.take())
}

/// Bindings the desktop currently holds for this entry. `None` means the
/// desktop keeps its shortcuts elsewhere and the in-app list stays authoritative.
#[tauri::command]
async fn list_global_shortcuts() -> Result<Option<Vec<kde_shortcuts::Binding>>, String> {
    tauri::async_runtime::spawn_blocking(kde_shortcuts::list)
        .await
        .map_err(|error| error.to_string())?
}

/// Replaces the complete Sniplex shortcut set on the desktop atomically.
///
/// The whole edit is either applied or the desktop is returned to its previous
/// bindings, so Sniplex never leaves its UI and the desktop in different states.
#[tauri::command]
async fn set_global_shortcuts(
    bindings: Vec<kde_shortcuts::Binding>,
) -> Result<Vec<kde_shortcuts::Binding>, String> {
    tauri::async_runtime::spawn_blocking(move || kde_shortcuts::set_all(bindings))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let action = launcher::requested_mode();

    // The desktop entry starts this programme once per shortcut press. When an
    // instance is already running, the request goes there and no window opens.
    if launcher::hand_off(&action) {
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(launcher::LaunchState::new(action))
        .invoke_handler(tauri::generate_handler![
            select_folder,
            save_screenshot,
            capture_desktop,
            start_capture_session,
            get_capture_session,
            get_capture_frame,
            log_timing,
            timing_enabled,
            show_capture_overlay,
            complete_capture,
            cancel_capture,
            open_capture_window,
            take_capture_payload,
            restore_window,
            get_detected_windows,
            copy_image_to_clipboard,
            exit_app,
            sync_global_shortcuts,
            take_launch_action,
            list_global_shortcuts,
            set_global_shortcuts
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
            app.manage(AppCaptureState::default());
            app.manage(CaptureWindowStore::default());
            prune_capture_files();
            launcher::serve(app.handle());

            // The interface never zooms. A touchpad pinch belongs to the capture
            // canvas, so WebKitGTK's internal page-zoom gesture is detached and
            // replaced by one that forwards the scale to the frontend instead.
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.with_webview(|webview| {
                    use gtk::prelude::*;
                    use webkit2gtk::WebViewExt;

                    let view = webview.inner();

                    fn forward_pinch(
                        view: &webkit2gtk::WebView,
                        phase: &str,
                        scale: f64,
                        x: f64,
                        y: f64,
                    ) {
                        let script = format!(
                            "window.__sniplexPinch && window.__sniplexPinch('{phase}', {scale}, {x}, {y})"
                        );
                        #[allow(deprecated)]
                        view.run_javascript(&script, gtk::gio::Cancellable::NONE, |_| {});
                    }

                    // WebKit stores its page-zoom gesture on the view under this
                    // key. Removing its handlers stops the whole interface from
                    // scaling while the gesture object itself stays intact.
                    unsafe {
                        if let Some(gesture) = view.data::<gtk::GestureZoom>("wk-view-zoom-gesture")
                        {
                            gobject_sys::g_signal_handlers_destroy(gesture.as_ptr().cast());
                        }
                    }

                    let gesture = gtk::GestureZoom::new(&view);
                    gesture.set_propagation_phase(gtk::PropagationPhase::Capture);

                    let begin_view = view.clone();
                    gesture.connect_begin(move |gesture, _| {
                        let (x, y) = gesture.bounding_box_center().unwrap_or((0.0, 0.0));
                        forward_pinch(&begin_view, "start", 1.0, x, y);
                    });

                    let update_view = view.clone();
                    gesture.connect_scale_changed(move |gesture, scale| {
                        let (x, y) = gesture.bounding_box_center().unwrap_or((0.0, 0.0));
                        forward_pinch(&update_view, "update", scale, x, y);
                    });

                    let end_view = view.clone();
                    gesture.connect_end(move |gesture, _| {
                        let (x, y) = gesture.bounding_box_center().unwrap_or((0.0, 0.0));
                        forward_pinch(&end_view, "end", 1.0, x, y);
                    });
                });
            }
            // Warm the external capture tool's interpreter/runtime cache so
            // the first fallback snip does not pay for a cold start. The
            // compositor path needs no helper, and spawning one would only
            // contend for disk and CPU while the app is starting.
            if !should_try_native_capture() {
                std::thread::spawn(prewarm_capture_backend);
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_image_dimensions_bmp() {
        let mut header = vec![b'B', b'M'];
        header.extend_from_slice(&[0; 16]); // padding up to byte 18
        header.extend_from_slice(&1920u32.to_le_bytes()); // width at bytes 18..22
        header.extend_from_slice(&1080u32.to_le_bytes()); // height at bytes 22..26

        let dims = parse_image_dimensions(&header);
        assert_eq!(dims, Some((1920, 1080, "image/bmp")));
    }

    #[test]
    fn test_parse_png_dimensions_valid() {
        // Construct minimal valid PNG header with width=1920, height=1080
        let mut header = vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
        header.extend_from_slice(&[0, 0, 0, 13]); // chunk length
        header.extend_from_slice(b"IHDR"); // chunk type
        header.extend_from_slice(&1920u32.to_be_bytes()); // width
        header.extend_from_slice(&1080u32.to_be_bytes()); // height
        header.extend_from_slice(&[8, 6, 0, 0, 0]); // bit depth, color type, compression, filter, interlace

        let dims = parse_png_dimensions(&header);
        assert_eq!(dims, Some((1920, 1080)));
    }

    #[test]
    fn test_parse_png_dimensions_invalid() {
        let invalid = vec![1, 2, 3, 4, 5];
        assert_eq!(parse_png_dimensions(&invalid), None);
    }

    #[test]
    fn test_parse_kdotool_geometry() {
        let sample = "Window {28d98683-d7df-4bb5-a244-8e1cc1eb2990}\n  Position: 100,50 (screen: 0)\n  Geometry: 800x600\n";
        let parsed = parse_kdotool_geometry(sample);
        assert_eq!(parsed, Some((100, 50, 800, 600)));
    }

    #[test]
    fn test_parse_wmctrl_line() {
        let sample = "0x02800003  0 100  200  800  600 hostname Sample Editor Window";
        let parsed = parse_wmctrl_line(sample);
        assert!(parsed.is_some());
        let rect = parsed.unwrap();
        assert_eq!(rect.x, 100);
        assert_eq!(rect.y, 200);
        assert_eq!(rect.width, 800);
        assert_eq!(rect.height, 600);
        assert_eq!(rect.title, "Sample Editor Window");
    }

    #[test]
    fn test_normalize_window_coordinates() {
        let mut windows = vec![
            WindowRect {
                id: "w1".into(),
                title: "Maximized IDE".into(),
                x: 0,
                y: 0,
                width: 1324,
                height: 701,
            },
            WindowRect {
                id: "w2".into(),
                title: "Editor Dialog".into(),
                x: 258,
                y: 84,
                width: 808,
                height: 533,
            },
        ];

        // 1324x745 logical bounds to 1920x1080 capture frame
        normalize_window_coordinates(&mut windows, 1920, 1080, Some((1324, 745)));

        assert_eq!(windows[0].x, 0);
        assert_eq!(windows[0].y, 0);
        assert_eq!(windows[0].width, 1920);
        assert_eq!(windows[0].height, 1016);

        assert_eq!(windows[1].x, 374);
        assert_eq!(windows[1].y, 122);
        assert_eq!(windows[1].width, 1172);
        assert_eq!(windows[1].height, 773);
    }

    #[test]
    fn test_decode_png_base64_accepts_png_signature() {
        let mut payload = b"\x89PNG\r\n\x1a\n".to_vec();
        payload.extend_from_slice(&[0, 0, 0, 13]);
        let encoded = BASE64_STANDARD.encode(&payload);

        let decoded = decode_png_base64(&encoded).expect("valid PNG payload");
        assert_eq!(decoded, payload);
    }

    #[test]
    fn test_decode_png_base64_rejects_other_payloads() {
        assert!(decode_png_base64(&BASE64_STANDARD.encode(b"GIF89a")).is_err());
        assert!(decode_png_base64("not base64 !!").is_err());
        assert!(decode_png_base64("").is_err());
    }

    #[test]
    fn test_live_detect() {
        let (mut wins, bounds) = detect_desktop_windows();
        println!("LIVE DETECT: bounds={:?}", bounds);
        for w in &wins {
            println!("  RAW WIN: {} (id={}) at {},{} {}x{}", w.title, w.id, w.x, w.y, w.width, w.height);
        }
        normalize_window_coordinates(&mut wins, 1920, 1080, bounds);
        for w in &wins {
            println!("  NORM WIN: {} (id={}) at {},{} {}x{}", w.title, w.id, w.x, w.y, w.width, w.height);
        }
        assert!(!wins.is_empty(), "Should detect at least 1 window on desktop");
    }
}
