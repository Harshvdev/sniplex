#[tauri::command]
fn select_folder() -> Result<Option<String>, String> {
  if let Ok(output) = std::process::Command::new("zenity")
    .args(["--file-selection", "--directory", "--title=Select Screenshots Folder"])
    .output()
  {
    if output.status.success() {
      let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
      if !path.is_empty() {
        return Ok(Some(path));
      }
    }
  } else if let Ok(output) = std::process::Command::new("kdialog")
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
    .invoke_handler(tauri::generate_handler![select_folder])
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
