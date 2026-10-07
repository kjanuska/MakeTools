mod fsops;

use fsops::{BackupEntry, Backups, FileEntry, TextFile};
use std::path::Path;
use tauri::{AppHandle, Manager};

fn backups(app: &AppHandle) -> Result<Backups, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| Backups::new(dir.join("backups")))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_files(dir: String, extension: String) -> Result<Vec<FileEntry>, String> {
    fsops::list_files(Path::new(&dir), &extension).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_text(path: String) -> Result<TextFile, String> {
    fsops::read_text(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_text(app: AppHandle, path: String, text: String) -> Result<(), String> {
    fsops::save_bytes(&backups(&app)?, Path::new(&path), text.as_bytes(), fsops::now_ms())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_backups(app: AppHandle, path: String) -> Result<Vec<BackupEntry>, String> {
    backups(&app)?.list(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn restore_backup(app: AppHandle, path: String, id: String) -> Result<(), String> {
    fsops::restore_backup(&backups(&app)?, Path::new(&path), &id, fsops::now_ms())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_backup(app: AppHandle, path: String, id: String) -> Result<TextFile, String> {
    fsops::read_backup(&backups(&app)?, Path::new(&path), &id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_file(path: String, text: String) -> Result<(), String> {
    fsops::create_file(Path::new(&path), text.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn rename_file(app: AppHandle, from: String, to: String) -> Result<(), String> {
    fsops::rename_file(&backups(&app)?, Path::new(&from), Path::new(&to), fsops::now_ms())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_file(app: AppHandle, path: String) -> Result<(), String> {
    fsops::delete_file(&backups(&app)?, Path::new(&path), fsops::now_ms()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Reopen at the size (and maximized state) the window had when it was closed.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .setup(|app| {
            // Clear week-old backups on start; a failure here must not block the app.
            if let Ok(b) = backups(app.handle()) {
                let _ = b.prune(fsops::now_ms());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_files,
            read_text,
            save_text,
            list_backups,
            restore_backup,
            read_backup,
            create_file,
            rename_file,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
