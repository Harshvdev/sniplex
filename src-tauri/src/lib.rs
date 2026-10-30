use base64::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;
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

fn execute_screen_grab(output_path: &str) -> bool {
    let is_bmp = output_path.ends_with(".bmp");
    let desktop_env = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_uppercase();

    // 1. Try spectacle background capture (KDE Plasma)
    if let Ok(status) = Command::new("spectacle")
        .args(["-b", "-n", "-o", output_path])
        .status()
    {
        if status.success() {
            if let Ok(meta) = fs::metadata(output_path) {
                if meta.len() > 0 {
                    return true;
                }
            }
        }
    }

    // Fallback: try spectacle with explicit fullscreen flag
    if let Ok(status) = Command::new("spectacle")
        .args(["-b", "-n", "-f", "-o", output_path])
        .status()
    {
        if status.success() {
            if let Ok(meta) = fs::metadata(output_path) {
                if meta.len() > 0 {
                    return true;
                }
            }
        }
    }

    // If BMP was requested and spectacle failed, switch to PNG path for standard tools
    let target_path = if is_bmp {
        output_path.replace(".bmp", ".png")
    } else {
        output_path.to_string()
    };

    // 2. Try gnome-screenshot (GNOME on Wayland or X11; skip on KDE to avoid X11 assertion bugs)
    if !desktop_env.contains("KDE") {
        if let Ok(status) = Command::new("gnome-screenshot")
            .args(["-f", &target_path])
            .status()
        {
            if status.success() {
                if let Ok(meta) = fs::metadata(&target_path) {
                    if meta.len() > 0 {
                        if is_bmp {
                            let _ = fs::rename(&target_path, output_path);
                        }
                        return true;
                    }
                }
            }
        }
    }

    // 3. Try grim (wlroots-based Wayland compositors: Sway, Hyprland, Wayfire)
    if let Ok(status) = Command::new("grim").arg(&target_path).status() {
        if status.success() {
            if let Ok(meta) = fs::metadata(&target_path) {
                if meta.len() > 0 {
                    if is_bmp {
                        let _ = fs::rename(&target_path, output_path);
                    }
                    return true;
                }
            }
        }
    }

    // 4. Try maim (X11)
    if let Ok(status) = Command::new("maim").arg(&target_path).status() {
        if status.success() {
            if let Ok(meta) = fs::metadata(&target_path) {
                if meta.len() > 0 {
                    if is_bmp {
                        let _ = fs::rename(&target_path, output_path);
                    }
                    return true;
                }
            }
        }
    }

    // 5. Try scrot (X11)
    if let Ok(status) = Command::new("scrot").arg(&target_path).status() {
        if status.success() {
            if let Ok(meta) = fs::metadata(&target_path) {
                if meta.len() > 0 {
                    if is_bmp {
                        let _ = fs::rename(&target_path, output_path);
                    }
                    return true;
                }
            }
        }
    }

    // 6. Try ImageMagick import (X11)
    if let Ok(status) = Command::new("import")
        .args(["-window", "root", &target_path])
        .status()
    {
        if status.success() {
            if let Ok(meta) = fs::metadata(&target_path) {
                if meta.len() > 0 {
                    if is_bmp {
                        let _ = fs::rename(&target_path, output_path);
                    }
                    return true;
                }
            }
        }
    }

    false
}

#[tauri::command]
fn start_capture_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppCaptureState>,
    mode: String,
    snip_type: String,
    delay: u32,
) -> Result<(), String> {
    // 1. Immediately hide main editor window cleanly
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(25));

    // 2. Prepare fast in-memory RAM disk temp path (/dev/shm)
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let shm_dir = std::path::Path::new("/dev/shm");
    let base_dir = if shm_dir.exists() && shm_dir.is_dir() {
        shm_dir
    } else {
        std::path::Path::new("/tmp")
    };
    let temp_path = base_dir.join(format!("sniplex_freeze_{}.bmp", timestamp));
    let temp_path_str = temp_path.to_string_lossy().to_string();

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

    let bytes = fs::read(&temp_path).map_err(|e| format!("Failed to read captured buffer: {}", e))?;
    let _ = fs::remove_file(&temp_path);

    let (width, height, mime) = parse_image_dimensions(&bytes).unwrap_or((1920, 1080, "image/png"));
    let image_data_url = format!("data:{};base64,{}", mime, BASE64_STANDARD.encode(&bytes));

    let capture = DesktopCapture {
        image_data_url: image_data_url.clone(),
        width,
        height,
        windows,
    };

    // In Full-Screen mode, resolve instantly directly back into main window
    if snip_type == "fullscreen" {
        let payload = serde_json::json!({
            "imageUrl": image_data_url,
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

    let session = CaptureSession {
        capture,
        mode,
        snip_type,
        delay,
    };

    if let Ok(mut lock) = state.session.lock() {
        *lock = Some(session.clone());
    }

    // Notify overlay window that session data is ready;
    // the overlay window will decode the image bitmap and invoke show_capture_overlay
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("session-ready", &session);
    }

    Ok(())
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
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let shm_dir = std::path::Path::new("/dev/shm");
    let base_dir = if shm_dir.exists() && shm_dir.is_dir() {
        shm_dir
    } else {
        std::path::Path::new("/tmp")
    };
    let temp_path = base_dir.join(format!("sniplex_freeze_{}.bmp", timestamp));
    let temp_path_str = temp_path.to_string_lossy().to_string();

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

    let bytes = fs::read(&temp_path).map_err(|e| format!("Failed to read captured buffer: {}", e))?;
    let _ = fs::remove_file(&temp_path);

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
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.show();
        let _ = overlay.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn complete_capture(app: tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
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
