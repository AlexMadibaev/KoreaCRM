use crate::local_cache::open_database;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    operation_id: String,
    store_id: String,
    entity_type: String,
    entity_id: String,
    payload_json: String,
    created_at: String,
    attempts: i64,
    status: String,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSummary {
    pending: i64,
    syncing: i64,
    synced: i64,
    errors: i64,
    conflicts: i64,
    last_synced_at: Option<String>,
}

fn scope(user_id: &str, store_id: &str) -> Result<String, String> {
    if user_id.trim().is_empty() || store_id.trim().is_empty() {
        return Err("User and store IDs are required".into());
    }
    Ok(format!("{user_id}:{store_id}"))
}

fn enqueue(connection: &Connection, user_id: &str, store_id: &str, operation_id: &str, payload_json: &str) -> Result<(), String> {
    let scope_key = scope(user_id, store_id)?;
    let payload: serde_json::Value = serde_json::from_str(payload_json).map_err(|error| error.to_string())?;
    if payload.get("operationId").and_then(|value| value.as_str()) != Some(operation_id) {
        return Err("Operation ID does not match sale payload".into());
    }
    connection.execute("INSERT OR IGNORE INTO sync_queue (operation_id,scope_key,entity_type,entity_id,payload_json) VALUES (?1,?2,'SALE',?1,?3)", params![operation_id, scope_key, payload_json]).map_err(|error| error.to_string())?;
    let saved: (String, String) = connection.query_row("SELECT scope_key,payload_json FROM sync_queue WHERE operation_id=?1", [operation_id], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|error| error.to_string())?;
    if saved.0 != scope_key || saved.1 != payload_json {
        return Err("Operation ID was already used for another sale".into());
    }
    Ok(())
}

fn list(connection: &Connection, user_id: &str, store_id: &str) -> Result<Vec<QueueEntry>, String> {
    let scope_key = scope(user_id, store_id)?;
    let mut statement = connection.prepare("SELECT operation_id,entity_type,entity_id,payload_json,created_at,attempts,status,error FROM sync_queue WHERE scope_key=?1 AND status IN ('PENDING','SYNCING','ERROR','CONFLICT') ORDER BY created_at,operation_id").map_err(|error| error.to_string())?;
    let rows = statement.query_map([scope_key], |row| Ok(QueueEntry { operation_id: row.get(0)?, store_id: store_id.into(), entity_type: row.get(1)?, entity_id: row.get(2)?, payload_json: row.get(3)?, created_at: row.get(4)?, attempts: row.get(5)?, status: row.get(6)?, error: row.get(7)? })).map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|error| error.to_string())
}

fn summary(connection: &Connection, user_id: &str, store_id: &str) -> Result<QueueSummary, String> {
    let scope_key = scope(user_id, store_id)?;
    let count = |status: &str| connection.query_row("SELECT COUNT(*) FROM sync_queue WHERE scope_key=?1 AND status=?2", params![scope_key, status], |row| row.get(0)).map_err(|error| error.to_string());
    let last_synced_at = connection.query_row("SELECT MAX(synced_at) FROM sync_queue WHERE scope_key=?1", [&scope_key], |row| row.get(0)).map_err(|error| error.to_string())?;
    Ok(QueueSummary { pending: count("PENDING")?, syncing: count("SYNCING")?, synced: count("SYNCED")?, errors: count("ERROR")?, conflicts: count("CONFLICT")?, last_synced_at })
}

fn update_status(connection: &Connection, user_id: &str, store_id: &str, operation_id: &str, status: &str, error: Option<&str>) -> Result<(), String> {
    if !["SYNCING", "SYNCED", "ERROR", "CONFLICT"].contains(&status) {
        return Err("Invalid queue status".into());
    }
    let scope_key = scope(user_id, store_id)?;
    let changed = connection.execute("UPDATE sync_queue SET status=?1,error=?2,attempts=attempts+CASE WHEN ?1='SYNCING' THEN 1 ELSE 0 END,synced_at=CASE WHEN ?1='SYNCED' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE synced_at END WHERE operation_id=?3 AND scope_key=?4 AND status<>'SYNCED'", params![status, error, operation_id, scope_key]).map_err(|error| error.to_string())?;
    if changed == 0 {
        let existing = connection.query_row("SELECT status FROM sync_queue WHERE operation_id=?1 AND scope_key=?2", params![operation_id, scope_key], |row| row.get::<_, String>(0)).optional().map_err(|error| error.to_string())?;
        if existing.as_deref() != Some("SYNCED") || status != "SYNCED" { return Err("Queue operation not found or already synced".into()); }
    }
    Ok(())
}

fn retry_conflict(connection: &Connection, user_id: &str, store_id: &str, operation_id: &str) -> Result<(), String> {
    let scope_key = scope(user_id, store_id)?;
    let changed = connection.execute("UPDATE sync_queue SET status='PENDING',error=NULL WHERE operation_id=?1 AND scope_key=?2 AND status='CONFLICT'", params![operation_id, scope_key]).map_err(|error| error.to_string())?;
    if changed != 1 { return Err("Conflict sale was not found for this user and store".into()); }
    Ok(())
}

#[tauri::command]
pub fn enqueue_sale(app: tauri::AppHandle, user_id: String, store_id: String, operation_id: String, payload_json: String) -> Result<(), String> {
    let connection = open_database(&app)?;
    enqueue(&connection, &user_id, &store_id, &operation_id, &payload_json)
}

#[tauri::command]
pub fn list_sync_queue(app: tauri::AppHandle, user_id: String, store_id: String) -> Result<Vec<QueueEntry>, String> {
    let connection = open_database(&app)?;
    list(&connection, &user_id, &store_id)
}

#[tauri::command]
pub fn sync_queue_summary(app: tauri::AppHandle, user_id: String, store_id: String) -> Result<QueueSummary, String> {
    let connection = open_database(&app)?;
    summary(&connection, &user_id, &store_id)
}

#[tauri::command]
pub fn set_sync_status(app: tauri::AppHandle, user_id: String, store_id: String, operation_id: String, status: String, error: Option<String>) -> Result<(), String> {
    let connection = open_database(&app)?;
    update_status(&connection, &user_id, &store_id, &operation_id, &status, error.as_deref())
}

#[tauri::command]
pub fn retry_conflict_sale(app: tauri::AppHandle, user_id: String, store_id: String, operation_id: String) -> Result<(), String> {
    let connection = open_database(&app)?;
    retry_conflict(&connection, &user_id, &store_id, &operation_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_cache::initialize;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn twenty_sales_survive_reopen_and_retries_do_not_duplicate() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("koreacrm-sync-{}-{nonce}.sqlite", std::process::id()));
        {
            let db = Connection::open(&path).unwrap();
            initialize(&db).unwrap();
            for index in 0..20 {
                let id = format!("operation-{index}");
                let payload = format!(r#"{{"operationId":"{id}","items":[]}}"#);
                enqueue(&db, "user-a", "store-a", &id, &payload).unwrap();
                enqueue(&db, "user-a", "store-a", &id, &payload).unwrap();
            }
            assert_eq!(summary(&db, "user-a", "store-a").unwrap().pending, 20);
        }
        {
            let db = Connection::open(&path).unwrap();
            initialize(&db).unwrap();
            assert_eq!(list(&db, "user-a", "store-a").unwrap().len(), 20);
            assert_eq!(list(&db, "user-b", "store-a").unwrap().len(), 0);
            update_status(&db, "user-a", "store-a", "operation-0", "SYNCING", None).unwrap();
            update_status(&db, "user-a", "store-a", "operation-0", "SYNCED", None).unwrap();
            update_status(&db, "user-a", "store-a", "operation-0", "SYNCED", None).unwrap();
            assert_eq!(summary(&db, "user-a", "store-a").unwrap().synced, 1);
            assert_eq!(summary(&db, "user-a", "store-a").unwrap().pending, 19);
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn conflict_retry_preserves_sale_and_requires_matching_scope() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let payload = r#"{"operationId":"operation-1","items":[{"productId":"product-1","quantity":2}]}"#;
        enqueue(&db, "user-a", "store-a", "operation-1", payload).unwrap();
        update_status(&db, "user-a", "store-a", "operation-1", "CONFLICT", Some("Shift closed")).unwrap();
        assert!(retry_conflict(&db, "user-b", "store-a", "operation-1").is_err());
        assert!(retry_conflict(&db, "user-a", "store-b", "operation-1").is_err());
        retry_conflict(&db, "user-a", "store-a", "operation-1").unwrap();
        let entries = list(&db, "user-a", "store-a").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].status, "PENDING");
        assert_eq!(entries[0].payload_json, payload);
        assert!(retry_conflict(&db, "user-a", "store-a", "operation-1").is_err());
        update_status(&db, "user-a", "store-a", "operation-1", "SYNCED", None).unwrap();
        assert!(retry_conflict(&db, "user-a", "store-a", "operation-1").is_err());
    }
}
