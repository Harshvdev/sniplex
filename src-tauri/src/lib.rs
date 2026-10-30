use base64::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;

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

pub fn parse_png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() >= 24 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n" {
        let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        Some((width, height))
    } else {
        None
    }
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

pub fn detect_desktop_windows() -> Vec<WindowRect> {
    let mut windows = Vec::new();

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

                // Exclude Sniplex itself
                if title.to_lowercase().contains("sniplex") {
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
                        if !rect.title.to_lowercase().contains("sniplex") {
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
    // 1. Try spectacle background capture
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

    // 2. Try grim (wlroots-based Wayland compositors)
    if let Ok(status) = Command::new("grim").arg(output_path).status() {
        if status.success() {
            if let Ok(meta) = fs::metadata(output_path) {
                if meta.len() > 0 {
                    return true;
                }
            }
        }
    }

    // 3. Try maim (X11)
    if let Ok(status) = Command::new("maim").arg(output_path).status() {
        if status.success() {
            if let Ok(meta) = fs::metadata(output_path) {
                if meta.len() > 0 {
                    return true;
                }
            }
        }
    }

    // 4. Try scrot (X11)
    if let Ok(status) = Command::new("scrot").arg(output_path).status() {
        if status.success() {
            if let Ok(meta) = fs::metadata(output_path) {
                if meta.len() > 0 {
                    return true;
                }
            }
        }
    }

    // 5. Try ImageMagick import (X11)
    if let Ok(status) = Command::new("import")
        .args(["-window", "root", output_path])
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

    false
}

#[tauri::command]
fn capture_desktop(window: tauri::Window) -> Result<DesktopCapture, String> {
    // 1. Ensure window is marked maximized and hide before display freeze
    let _ = window.maximize();
    let _ = window.hide();
    std::thread::sleep(std::time::Duration::from_millis(200));

    // 2. Prepare temp path
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let temp_path = std::env::temp_dir().join(format!("sniplex_freeze_{}.png", timestamp));
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let captured = execute_screen_grab(&temp_path_str);

    if !captured {
        let _ = window.show();
        let _ = window.set_focus();
        return Err("Unable to capture screen using available desktop capture backends".to_string());
    }

    let bytes = fs::read(&temp_path).map_err(|e| format!("Failed to read captured buffer: {}", e))?;
    let _ = fs::remove_file(&temp_path);

    let (width, height) = parse_png_dimensions(&bytes).unwrap_or((1920, 1080));
    let windows = detect_desktop_windows();
    let image_data_url = format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&bytes));

    // 3. Map window to screen and enter fullscreen capture overlay
    let _ = window.maximize();
    let _ = window.show();
    std::thread::sleep(std::time::Duration::from_millis(50));
    let _ = window.set_fullscreen(true);
    let _ = window.set_focus();

    Ok(DesktopCapture {
        image_data_url,
        width,
        height,
        windows,
    })
}

#[tauri::command]
fn restore_window(window: tauri::Window) -> Result<(), String> {
    let _ = window.set_fullscreen(false);
    // Allow the display compositor time to process unfullscreen before maximizing
    std::thread::sleep(std::time::Duration::from_millis(150));
    let _ = window.maximize();
    let _ = window.show();
    let _ = window.set_focus();

    // Verify maximize took effect; if not, re-apply after another short interval
    if let Ok(false) = window.is_maximized() {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let _ = window.maximize();
    }

    Ok(())
}

#[tauri::command]
fn get_detected_windows() -> Result<Vec<WindowRect>, String> {
    Ok(detect_desktop_windows())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            select_folder,
            capture_desktop,
            restore_window,
            get_detected_windows
        ])
        .setup(|app| {
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
