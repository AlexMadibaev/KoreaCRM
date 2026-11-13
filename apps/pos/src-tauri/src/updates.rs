use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub async fn check_pos_update(app: AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    Ok(update.map(|update| update.version))
}

#[tauri::command]
pub async fn install_pos_update(app: AppHandle, version: String) -> Result<(), String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?
        .filter(|update| update.version == version)
        .ok_or_else(|| "Предложенная версия изменилась".to_owned())?;

    update.download_and_install(|_, _| {}, || {}).await
        .map_err(|error| error.to_string())
}
