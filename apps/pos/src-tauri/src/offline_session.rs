use crate::local_cache::open_database;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    device_id: String,
    api_url: String,
    login: String,
    user_id: String,
    store_id: String,
    store_json: String,
    methods_json: String,
    permissions_json: String,
    salt: String,
    verifier: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineSession {
    login: String,
    user_id: String,
    store_id: String,
    store_json: String,
    methods_json: String,
    permissions_json: String,
    salt: String,
    verifier: String,
    shift_json: Option<String>,
}

fn save(connection: &Connection, input: &SessionInput) -> Result<(), String> {
    if [&input.device_id, &input.api_url, &input.login, &input.user_id, &input.store_id, &input.salt, &input.verifier].iter().any(|value| value.trim().is_empty()) {
        return Err("Offline session fields are required".into());
    }
    connection.execute("INSERT INTO offline_sessions (device_id,api_url,login,user_id,store_id,store_json,methods_json,permissions_json,salt,verifier,ready,saved_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,0,strftime('%s','now')) ON CONFLICT(device_id,api_url,login) DO UPDATE SET user_id=excluded.user_id,store_id=excluded.store_id,store_json=excluded.store_json,methods_json=excluded.methods_json,permissions_json=excluded.permissions_json,salt=excluded.salt,verifier=excluded.verifier,shift_json=NULL,ready=0,saved_at=excluded.saved_at", params![input.device_id, input.api_url, input.login, input.user_id, input.store_id, input.store_json, input.methods_json, input.permissions_json, input.salt, input.verifier]).map_err(|error| error.to_string())?;
    Ok(())
}

fn save_code(connection: &Connection, input: &SessionInput) -> Result<(), String> {
    if [&input.device_id, &input.api_url, &input.login, &input.user_id, &input.store_id, &input.salt, &input.verifier].iter().any(|value| value.trim().is_empty()) {
        return Err("Offline code session fields are required".into());
    }
    connection.execute("INSERT INTO offline_sessions (device_id,api_url,login,user_id,store_id,store_json,methods_json,permissions_json,salt,verifier,code_salt,code_verifier,ready,saved_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'','',?9,?10,0,strftime('%s','now')) ON CONFLICT(device_id,api_url,login) DO UPDATE SET user_id=excluded.user_id,store_id=excluded.store_id,store_json=excluded.store_json,methods_json=excluded.methods_json,permissions_json=excluded.permissions_json,code_salt=excluded.code_salt,code_verifier=excluded.code_verifier,shift_json=NULL,ready=0,saved_at=excluded.saved_at", params![input.device_id, input.api_url, input.login, input.user_id, input.store_id, input.store_json, input.methods_json, input.permissions_json, input.salt, input.verifier]).map_err(|error| error.to_string())?;
    Ok(())
}

fn ready(connection: &Connection, device_id: &str, api_url: &str, login: &str, store_id: &str, store_json: &str, shift_json: Option<&str>) -> Result<(), String> {
    let updated = connection.execute("UPDATE offline_sessions SET ready=1,store_id=?1,store_json=?2,shift_json=?3 WHERE device_id=?4 AND api_url=?5 AND login=?6", params![store_id, store_json, shift_json, device_id, api_url, login]).map_err(|error| error.to_string())?;
    if updated != 1 { return Err("Offline session was not saved for this device and store".into()); }
    Ok(())
}

fn load(connection: &Connection, device_id: &str, api_url: &str, login: &str) -> Result<Option<OfflineSession>, String> {
    connection.query_row("SELECT login,user_id,store_id,store_json,methods_json,permissions_json,salt,verifier,shift_json FROM offline_sessions WHERE device_id=?1 AND api_url=?2 AND login=?3 AND ready=1 AND salt<>'' AND saved_at>=CAST(strftime('%s','now') AS INTEGER)-604800", params![device_id, api_url, login], |row| Ok(OfflineSession { login: row.get(0)?, user_id: row.get(1)?, store_id: row.get(2)?, store_json: row.get(3)?, methods_json: row.get(4)?, permissions_json: row.get(5)?, salt: row.get(6)?, verifier: row.get(7)?, shift_json: row.get(8)? })).optional().map_err(|error| error.to_string())
}

fn load_codes(connection: &Connection, device_id: &str, api_url: &str) -> Result<Vec<OfflineSession>, String> {
    let mut statement = connection.prepare("SELECT login,user_id,store_id,store_json,methods_json,permissions_json,code_salt,code_verifier,shift_json FROM offline_sessions WHERE device_id=?1 AND api_url=?2 AND ready=1 AND code_salt IS NOT NULL AND code_verifier IS NOT NULL AND saved_at>=CAST(strftime('%s','now') AS INTEGER)-604800 ORDER BY login").map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![device_id, api_url], |row| Ok(OfflineSession { login: row.get(0)?, user_id: row.get(1)?, store_id: row.get(2)?, store_json: row.get(3)?, methods_json: row.get(4)?, permissions_json: row.get(5)?, salt: row.get(6)?, verifier: row.get(7)?, shift_json: row.get(8)? })).map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_offline_session(app: tauri::AppHandle, input: SessionInput) -> Result<(), String> {
    let connection = open_database(&app)?;
    save(&connection, &input)
}

#[tauri::command]
pub fn save_offline_code_session(app: tauri::AppHandle, input: SessionInput) -> Result<(), String> {
    let connection = open_database(&app)?;
    save_code(&connection, &input)
}

#[tauri::command]
pub fn mark_offline_session_ready(app: tauri::AppHandle, device_id: String, api_url: String, login: String, store_id: String, store_json: String, shift_json: Option<String>) -> Result<(), String> {
    let connection = open_database(&app)?;
    ready(&connection, &device_id, &api_url, &login, &store_id, &store_json, shift_json.as_deref())
}

#[tauri::command]
pub fn read_offline_session(app: tauri::AppHandle, device_id: String, api_url: String, login: String) -> Result<Option<OfflineSession>, String> {
    let connection = open_database(&app)?;
    load(&connection, &device_id, &api_url, &login)
}

#[tauri::command]
pub fn read_offline_code_sessions(app: tauri::AppHandle, device_id: String, api_url: String) -> Result<Vec<OfflineSession>, String> {
    let connection = open_database(&app)?;
    load_codes(&connection, &device_id, &api_url)
}

#[tauri::command]
pub fn clear_offline_session(app: tauri::AppHandle, device_id: String, api_url: String, login: String) -> Result<(), String> {
    let connection = open_database(&app)?;
    connection.execute("DELETE FROM offline_sessions WHERE device_id=?1 AND api_url=?2 AND login=?3", params![device_id, api_url, login]).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_cache::initialize;

    #[test]
    fn offline_session_requires_registration_and_expires() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let input = SessionInput { device_id: "device-a".into(), api_url: "http://server".into(), login: "cashier".into(), user_id: "user-a".into(), store_id: "store-a".into(), store_json: "{}".into(), methods_json: "[]".into(), permissions_json: "[]".into(), salt: "salt".into(), verifier: "verifier".into() };
        save(&db, &input).unwrap();
        assert!(load(&db, "device-a", "http://server", "cashier").unwrap().is_none());
        ready(&db, "device-a", "http://server", "cashier", "store-a", "{}", None).unwrap();
        assert!(load(&db, "device-a", "http://server", "cashier").unwrap().is_some());
        ready(&db, "device-a", "http://server", "cashier", "store-b", "{\"id\":\"store-b\"}", None).unwrap();
        assert_eq!(load(&db, "device-a", "http://server", "cashier").unwrap().unwrap().store_id, "store-b");
        assert!(load(&db, "device-b", "http://server", "cashier").unwrap().is_none());
        db.execute("UPDATE offline_sessions SET saved_at=0", []).unwrap();
        assert!(load(&db, "device-a", "http://server", "cashier").unwrap().is_none());
    }

    #[test]
    fn offline_code_login_requires_registration_and_preserves_password_login() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let input = SessionInput { device_id: "device-a".into(), api_url: "http://server".into(), login: "cashier".into(), user_id: "user-a".into(), store_id: "store-a".into(), store_json: "{}".into(), methods_json: "[]".into(), permissions_json: "[]".into(), salt: "salt".into(), verifier: "verifier".into() };
        save(&db, &input).unwrap();
        save_code(&db, &input).unwrap();
        assert!(load_codes(&db, "device-a", "http://server").unwrap().is_empty());
        ready(&db, "device-a", "http://server", "cashier", "store-a", "{}", None).unwrap();
        assert_eq!(load_codes(&db, "device-a", "http://server").unwrap().len(), 1);
        assert!(load(&db, "device-a", "http://server", "cashier").unwrap().is_some());
        db.execute("UPDATE offline_sessions SET saved_at=0", []).unwrap();
        assert!(load_codes(&db, "device-a", "http://server").unwrap().is_empty());
    }

    #[test]
    fn existing_offline_sessions_gain_code_verifiers() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE offline_sessions (device_id TEXT NOT NULL, api_url TEXT NOT NULL, login TEXT NOT NULL, user_id TEXT NOT NULL, store_id TEXT NOT NULL, store_json TEXT NOT NULL, methods_json TEXT NOT NULL, permissions_json TEXT NOT NULL, salt TEXT NOT NULL, verifier TEXT NOT NULL, shift_json TEXT, ready INTEGER NOT NULL DEFAULT 0, saved_at INTEGER NOT NULL, PRIMARY KEY (device_id,api_url,login));").unwrap();
        initialize(&db).unwrap();
        let input = SessionInput { device_id: "device-a".into(), api_url: "http://server".into(), login: "cashier".into(), user_id: "user-a".into(), store_id: "store-a".into(), store_json: "{}".into(), methods_json: "[]".into(), permissions_json: "[]".into(), salt: "salt".into(), verifier: "verifier".into() };
        save_code(&db, &input).unwrap();
        ready(&db, "device-a", "http://server", "cashier", "store-a", "{}", None).unwrap();
        assert_eq!(load_codes(&db, "device-a", "http://server").unwrap().len(), 1);
    }
}
