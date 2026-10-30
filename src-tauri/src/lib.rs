use base64::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::io::Write;
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};

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
}

#[derive(Default)]
pub struct AppCaptureState {
    pub session: std::sync::Mutex<Option<CaptureSession>>,
    pub frame_path: std::sync::Mutex<Option<std::path::PathBuf>>,
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

pub fn detect_desktop_windows(scale_factor: f64) -> Vec<WindowRect> {
    let mut windows = Vec::new();
    let scale = if scale_factor > 0.1 { scale_factor } else { 1.0 };

    // 1. Try kdotool (KDE Wayland / X11)
    if let Ok(search_output) = Command::new("kdotool").args(["search", ""]).output() {
        if search_output.status.success() {
            let ids_str = String::from_utf8_lossy(&search_output.stdout);
            for id in ids_str.lines() {
                let id = id.trim();
                if id.is_empty() {
                    continue;
                }

                let mut title = String::new();
                if let Ok(name_out) = Command::new("kdotool").args(["getwindowname", id]).output() {
                    if name_out.status.success() {
                        title = String::from_utf8_lossy(&name_out.stdout).trim().to_string();
                    }
                }

                // Exclude Sniplex itself (exact match or window title prefix)
                let trimmed_title = title.trim();
                if trimmed_title == "Sniplex" || trimmed_title.starts_with("Sniplex -") {
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
                                    x: (x as f64 * scale).round() as i32,
                                    y: (y as f64 * scale).round() as i32,
                                    width: (width as f64 * scale).round() as u32,
                                    height: (height as f64 * scale).round() as u32,
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
                    if let Some(mut rect) = parse_wmctrl_line(line) {
                        let trimmed = rect.title.trim();
                        if trimmed != "Sniplex" && !trimmed.starts_with("Sniplex -") {
                            rect.x = (rect.x as f64 * scale).round() as i32;
                            rect.y = (rect.y as f64 * scale).round() as i32;
                            rect.width = (rect.width as f64 * scale).round() as u32;
                            rect.height = (rect.height as f64 * scale).round() as u32;
                            windows.push(rect);
                        }
                    }
                }
            }
        }
    }

    windows
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

fn execute_screen_grab(output_path: &str) -> bool {
    let desktop_env = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_uppercase();

    // 1. Try spectacle background capture (KDE Plasma)
    if run_capture_tool(
        Command::new("spectacle").args(["-b", "-n", "-o", output_path]),
        output_path,
    ) {
        return true;
    }

    // Fallback: try spectacle with explicit fullscreen flag
    if run_capture_tool(
        Command::new("spectacle").args(["-b", "-n", "-f", "-o", output_path]),
        output_path,
    ) {
        return true;
    }

    // 2. Try gnome-screenshot (GNOME on Wayland or X11; skip on KDE to avoid X11 assertion bugs)
    if !desktop_env.contains("KDE")
        && run_capture_tool(
            Command::new("gnome-screenshot").args(["-f", output_path]),
            output_path,
        )
    {
        return true;
    }

    // 3. Try grim (wlroots-based Wayland compositors: Sway, Hyprland, Wayfire)
    if run_capture_tool(Command::new("grim").arg(output_path), output_path) {
        return true;
    }

    // 4. Try maim (X11)
    if run_capture_tool(Command::new("maim").arg(output_path), output_path) {
        return true;
    }

    // 5. Try scrot (X11)
    if run_capture_tool(Command::new("scrot").arg(output_path), output_path) {
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

/// Performs the blocking parts of a capture session off the UI thread.
fn run_capture_session(
    app: tauri::AppHandle,
    mode: String,
    snip_type: String,
    delay: u32,
) -> Result<(), String> {
    // The capture backend needs ~200ms of startup before it actually grabs the
    // screen, which is well past the compositor's window-hide animation, so the
    // grab can be launched immediately instead of waiting for the editor to go.
    timing_log("capture_start");
    prune_capture_files();

    let frame_path = unique_capture_path("frame", "bmp");
    let scale_factor = app
        .get_webview_window("main")
        .and_then(|main| main.scale_factor().ok())
        .unwrap_or(1.0);

    // Freeze the display right away; window geometry is collected in parallel and
    // only needed for highlight frames, so it must not delay the overlay reveal.
    let screen_path = frame_path.clone();
    let screen_thread = std::thread::spawn(move || execute_screen_grab(&screen_path));
    let win_thread = std::thread::spawn(move || detect_desktop_windows(scale_factor));

    let captured = screen_thread.join().unwrap_or(false);
    timing_log("grab_done");

    if !captured {
        let _ = win_thread.join();
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
        return Err("Unable to capture screen using available desktop capture backends".to_string());
    }

    let (width, height) = read_capture_dimensions(&frame_path)
        .map(|(width, height, _)| (width, height))
        .unwrap_or((1920, 1080));

    // In Full-Screen mode, resolve instantly directly back into main window
    if snip_type == "fullscreen" {
        let _ = win_thread.join();
        let bytes = fs::read(&frame_path).map_err(|e| format!("Failed to read captured buffer: {}", e))?;
        let _ = fs::remove_file(&frame_path);
        let payload = serde_json::json!({
            "imageUrl": format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&bytes)),
            "width": width,
            "height": height,
            "mode": "fullscreen"
        });
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
            let _ = main.emit("snip-captured", &payload);
        }
        return Ok(());
    }

    let state = app.state::<AppCaptureState>();

    // Publish the frame location before notifying the overlay, so its fetch never races.
    if let Ok(mut frame) = state.frame_path.lock() {
        *frame = Some(std::path::PathBuf::from(&frame_path));
    }

    if let Ok(mut lock) = state.session.lock() {
        *lock = Some(CaptureSession {
            capture: DesktopCapture {
                image_data_url: String::new(),
                width,
                height,
                windows: Vec::new(),
            },
            mode,
            snip_type,
            delay,
        });
    }

    // Notify overlay window that the frozen frame is ready to be pulled over IPC
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("session-ready", ());
    }
    timing_log("session_sent");

    // Window highlight frames arrive after the overlay is already visible
    let windows = win_thread.join().unwrap_or_default();
    timing_log("windows_detected");
    if let Ok(mut lock) = state.session.lock() {
        if let Some(session) = lock.as_mut() {
            session.capture.windows = windows.clone();
        }
    }
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("windows-ready", &windows);
    }

    Ok(())
}

#[tauri::command]
async fn start_capture_session(
    app: tauri::AppHandle,
    mode: String,
    snip_type: String,
    delay: u32,
) -> Result<(), String> {
    timing_log("command_entry");
    // 1. Immediately hide main editor window cleanly
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }

    // 2. Grab the display and overlay the desktop without blocking the UI thread
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_capture_session(app_handle, mode, snip_type, delay)
    })
    .await
    .map_err(|e| format!("Capture task failed: {}", e))?
}

#[tauri::command]
fn get_capture_frame(
    state: tauri::State<'_, AppCaptureState>,
) -> Result<tauri::ipc::Response, String> {
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
fn capture_desktop(app: tauri::AppHandle) -> Result<DesktopCapture, String> {
    // 1. Immediately hide main editor window cleanly
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(25));

    // 2. Prepare fast in-memory RAM disk temp path (/dev/shm)
    let temp_path_str = unique_capture_path("freeze", "png");

    let scale_factor = if let Some(main) = app.get_webview_window("main") {
        main.scale_factor().unwrap_or(1.0)
    } else {
        1.0
    };

    // Run screen grab and window detection in parallel across separate threads
    let thread_path = temp_path_str.to_string();
    let screen_thread = std::thread::spawn(move || execute_screen_grab(&thread_path));
    let win_thread = std::thread::spawn(move || detect_desktop_windows(scale_factor));

    let captured = screen_thread.join().unwrap_or(false);
    let windows = win_thread.join().unwrap_or_default();

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

#[tauri::command]
fn complete_capture(app: tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    clear_capture_state(&app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
        let _ = main.emit("snip-captured", payload);
    }
    Ok(())
}

#[tauri::command]
fn cancel_capture(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    clear_capture_state(&app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
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
    let scale = window.scale_factor().unwrap_or(1.0);
    Ok(detect_desktop_windows(scale))
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

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            select_folder,
            capture_desktop,
            start_capture_session,
            get_capture_session,
            get_capture_frame,
            log_timing,
            timing_enabled,
            show_capture_overlay,
            complete_capture,
            cancel_capture,
            restore_window,
            get_detected_windows,
            exit_app
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
            prune_capture_files();
            // Warm the capture backend's interpreter/runtime cache in the
            // background so the first snip does not pay for a cold start.
            std::thread::spawn(prewarm_capture_backend);
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
}
