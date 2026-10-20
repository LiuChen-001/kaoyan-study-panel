#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::Write, sync::Mutex};
use tauri::Manager;

fn state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("progress.json"))
}

#[tauri::command]
fn load_state(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = state_path(&app)?;
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn load_migration_history(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let path = state_path(&app)?;
    let mut records = Vec::new();
    for entry in fs::read_dir(path.parent().ok_or("数据目录无效")?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "progress.bak" || (name.starts_with("progress-before-") && name.ends_with(".json")) {
            if let Ok(content) = fs::read_to_string(entry.path()) { records.push(content); }
        }
    }
    Ok(records)
}

#[tauri::command]
fn save_state(app: tauri::AppHandle, lock: tauri::State<'_, Mutex<()>>, content: String) -> Result<(), String> {
    let _guard = lock.lock().map_err(|e| e.to_string())?;
    serde_json::from_str::<serde_json::Value>(&content).map_err(|e| e.to_string())?;
    let path = state_path(&app)?;
    if let Ok(previous) = fs::read_to_string(&path) {
        let old: serde_json::Value = serde_json::from_str(&previous).unwrap_or(serde_json::Value::Null);
        let next: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let backup_name = old["version"].as_u64().filter(|v| (1..=11).contains(v))
            .map(|v| format!("progress-before-rich-text-v{}.json", v));
        if let Some(name) = backup_name.filter(|_| next["version"] == 12) {
            let backup = path.with_file_name(name);
            match fs::OpenOptions::new().write(true).create_new(true).open(backup) {
                Ok(mut file) => { file.write_all(previous.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?; }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.to_string()),
            }
        }
    }
    let temp = path.with_extension("tmp");
    let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    drop(file);
    // Keep the previous valid save recoverable if replacement is interrupted.
    if path.exists() { fs::copy(&path, path.with_extension("bak")).map_err(|e| e.to_string())?; }
    match fs::rename(&temp, &path) {
        Ok(()) => Ok(()),
        // Redirected Windows profile folders can report ERROR_NOT_SAME_DEVICE
        // even for sibling paths. The previous save is already backed up above.
        Err(error) if cfg!(windows) && error.raw_os_error() == Some(17) => {
            fs::copy(&temp, &path).map_err(|e| e.to_string())?;
            fs::OpenOptions::new().write(true).open(&path)
                .and_then(|file| file.sync_all()).map_err(|e| e.to_string())?;
            fs::remove_file(temp).map_err(|e| e.to_string())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(()))
        .invoke_handler(tauri::generate_handler![load_state, load_migration_history, save_state])
        .run(tauri::generate_context!())
        .expect("启动考研面板失败");
}
