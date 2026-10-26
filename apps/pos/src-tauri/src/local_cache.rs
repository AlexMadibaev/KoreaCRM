use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedProduct {
    pub id: String,
    pub name: String,
    pub sku: String,
    #[serde(default)]
    pub brand_id: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
    pub barcodes: Vec<String>,
    pub price_minor: Option<i64>,
    pub available_quantity: i64,
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedCustomer {
    pub id: String,
    pub first_name: String,
    pub last_name: Option<String>,
    pub phone: String,
    pub discount_percent: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSnapshot {
    pub user_id: String,
    pub store_id: String,
    pub products: Vec<CachedProduct>,
    pub customers: Vec<CachedCustomer>,
    pub permissions: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatus {
    pub store_id: String,
    pub product_count: i64,
    pub customer_count: i64,
    pub last_synced_at: Option<String>,
}

pub(crate) fn open_database(app: &tauri::AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let connection = Connection::open(dir.join("pos-cache.sqlite3")).map_err(|error| error.to_string())?;
    initialize(&connection).map_err(|error| error.to_string())?;
    Ok(connection)
}

pub(crate) fn initialize(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS cache_meta (
           store_id TEXT PRIMARY KEY,
           last_synced_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS cached_products (
           store_id TEXT NOT NULL,
           id TEXT NOT NULL,
           name TEXT NOT NULL,
           sku TEXT NOT NULL,
           brand_id TEXT,
           category_id TEXT,
           barcodes_json TEXT NOT NULL,
           price_minor INTEGER,
           available_quantity INTEGER NOT NULL,
           active INTEGER NOT NULL,
           PRIMARY KEY (store_id, id)
         );
         CREATE INDEX IF NOT EXISTS cached_products_sku ON cached_products(store_id, sku);
         CREATE TABLE IF NOT EXISTS cached_customers (
           store_id TEXT NOT NULL,
           id TEXT NOT NULL,
           first_name TEXT NOT NULL,
           last_name TEXT,
           phone TEXT NOT NULL,
           discount_percent TEXT NOT NULL DEFAULT '0',
           PRIMARY KEY (store_id, id)
         );
         CREATE TABLE IF NOT EXISTS cached_permissions (
           store_id TEXT NOT NULL,
           name TEXT NOT NULL,
           PRIMARY KEY (store_id, name)
         );
         CREATE TABLE IF NOT EXISTS offline_sessions (
           device_id TEXT NOT NULL,
           api_url TEXT NOT NULL,
           login TEXT NOT NULL,
           user_id TEXT NOT NULL,
           store_id TEXT NOT NULL,
           store_json TEXT NOT NULL,
           methods_json TEXT NOT NULL,
           permissions_json TEXT NOT NULL,
           salt TEXT NOT NULL,
           verifier TEXT NOT NULL,
           shift_json TEXT,
           ready INTEGER NOT NULL DEFAULT 0,
           saved_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
           PRIMARY KEY (device_id,api_url,login)
         );
         CREATE TABLE IF NOT EXISTS sync_queue (
           operation_id TEXT PRIMARY KEY,
           scope_key TEXT NOT NULL,
           entity_type TEXT NOT NULL,
           entity_id TEXT NOT NULL,
           payload_json TEXT NOT NULL,
           created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           attempts INTEGER NOT NULL DEFAULT 0,
           status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SYNCING','SYNCED','ERROR','CONFLICT')),
           error TEXT,
           synced_at TEXT
         );
         CREATE INDEX IF NOT EXISTS sync_queue_scope_status ON sync_queue(scope_key,status,created_at);",
    )?;
    let has_discount = connection.prepare("PRAGMA table_info(cached_customers)")?.query_map([], |row| row.get::<_, String>(1))?.collect::<rusqlite::Result<Vec<_>>>()?.iter().any(|column| column == "discount_percent");
    if !has_discount { connection.execute("ALTER TABLE cached_customers ADD COLUMN discount_percent TEXT NOT NULL DEFAULT '0'", [])?; }
    let product_columns = connection.prepare("PRAGMA table_info(cached_products)")?.query_map([], |row| row.get::<_, String>(1))?.collect::<rusqlite::Result<Vec<_>>>()?;
    if !product_columns.iter().any(|column| column == "brand_id") { connection.execute("ALTER TABLE cached_products ADD COLUMN brand_id TEXT", [])?; }
    if !product_columns.iter().any(|column| column == "category_id") { connection.execute("ALTER TABLE cached_products ADD COLUMN category_id TEXT", [])?; }
    Ok(())
}

fn replace_snapshot(connection: &mut Connection, snapshot: &CatalogSnapshot) -> Result<(), String> {
    if snapshot.store_id.trim().is_empty() || snapshot.user_id.trim().is_empty() {
        return Err("User and store IDs are required".into());
    }
    let scope = format!("{}:{}", snapshot.user_id, snapshot.store_id);
    let tx = connection.transaction().map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM cached_products WHERE store_id = ?1", [&scope]).map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM cached_customers WHERE store_id = ?1", [&scope]).map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM cached_permissions WHERE store_id = ?1", [&scope]).map_err(|error| error.to_string())?;
    for product in &snapshot.products {
        if product.id.is_empty() || product.available_quantity < 0 || product.price_minor.is_some_and(|price| price < 0) {
            return Err("Invalid cached product".into());
        }
        let barcodes = serde_json::to_string(&product.barcodes).map_err(|error| error.to_string())?;
        tx.execute("INSERT INTO cached_products (store_id,id,name,sku,brand_id,category_id,barcodes_json,price_minor,available_quantity,active) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", params![scope, product.id, product.name, product.sku, product.brand_id, product.category_id, barcodes, product.price_minor, product.available_quantity, product.active]).map_err(|error| error.to_string())?;
    }
    for customer in &snapshot.customers {
        tx.execute("INSERT INTO cached_customers (store_id,id,first_name,last_name,phone,discount_percent) VALUES (?1,?2,?3,?4,?5,?6)", params![scope, customer.id, customer.first_name, customer.last_name, customer.phone, customer.discount_percent]).map_err(|error| error.to_string())?;
    }
    for permission in &snapshot.permissions {
        tx.execute("INSERT INTO cached_permissions (store_id,name) VALUES (?1,?2)", params![scope, permission]).map_err(|error| error.to_string())?;
    }
    tx.execute("INSERT INTO cache_meta (store_id,last_synced_at) VALUES (?1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(store_id) DO UPDATE SET last_synced_at=excluded.last_synced_at", [&scope]).map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

fn status(connection: &Connection, user_id: &str, store_id: &str) -> rusqlite::Result<CacheStatus> {
    let scope = format!("{user_id}:{store_id}");
    let product_count = connection.query_row("SELECT COUNT(*) FROM cached_products WHERE store_id=?1", [&scope], |row| row.get(0))?;
    let customer_count = connection.query_row("SELECT COUNT(*) FROM cached_customers WHERE store_id=?1", [&scope], |row| row.get(0))?;
    let last_synced_at = connection.query_row("SELECT last_synced_at FROM cache_meta WHERE store_id=?1", [&scope], |row| row.get(0)).optional()?;
    Ok(CacheStatus { store_id: store_id.into(), product_count, customer_count, last_synced_at })
}

#[tauri::command]
pub fn save_catalog_snapshot(app: tauri::AppHandle, snapshot: CatalogSnapshot) -> Result<CacheStatus, String> {
    let mut connection = open_database(&app)?;
    replace_snapshot(&mut connection, &snapshot)?;
    status(&connection, &snapshot.user_id, &snapshot.store_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn catalog_cache_status(app: tauri::AppHandle, user_id: String, store_id: String) -> Result<CacheStatus, String> {
    let connection = open_database(&app)?;
    status(&connection, &user_id, &store_id).map_err(|error| error.to_string())
}

fn products_with_local_sales(connection: &Connection, user_id: &str, store_id: &str) -> Result<Vec<CachedProduct>, String> {
    let scope = format!("{user_id}:{store_id}");
    let mut statement = connection.prepare("SELECT id,name,sku,brand_id,category_id,barcodes_json,price_minor,available_quantity,active FROM cached_products WHERE store_id=?1 ORDER BY name,id").map_err(|error| error.to_string())?;
    let rows = statement.query_map([&scope], |row| {
        let barcodes_json: String = row.get(5)?;
        let barcodes = serde_json::from_str(&barcodes_json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error)))?;
        Ok(CachedProduct { id: row.get(0)?, name: row.get(1)?, sku: row.get(2)?, brand_id: row.get(3)?, category_id: row.get(4)?, barcodes, price_minor: row.get(6)?, available_quantity: row.get(7)?, active: row.get(8)? })
    }).map_err(|error| error.to_string())?;
    let mut products = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|error| error.to_string())?;
    let mut pending = connection.prepare("SELECT payload_json FROM sync_queue WHERE scope_key=?1 AND (status<>'SYNCED' OR created_at>COALESCE((SELECT last_synced_at FROM cache_meta WHERE store_id=?1),''))").map_err(|error| error.to_string())?;
    let payloads = pending.query_map([&scope], |row| row.get::<_, String>(0)).map_err(|error| error.to_string())?;
    let mut sold = std::collections::HashMap::<String, i64>::new();
    for payload in payloads {
        let value: serde_json::Value = serde_json::from_str(&payload.map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        if let Some(items) = value.get("items").and_then(|items| items.as_array()) {
            for item in items {
                if let (Some(id), Some(quantity)) = (item.get("productId").and_then(|id| id.as_str()), item.get("quantity").and_then(|quantity| quantity.as_i64())) {
                    *sold.entry(id.into()).or_default() += quantity.max(0);
                }
            }
        }
    }
    for product in &mut products {
        product.available_quantity = product.available_quantity.saturating_sub(*sold.get(&product.id).unwrap_or(&0)).max(0);
    }
    Ok(products)
}

#[tauri::command]
pub fn cached_products(app: tauri::AppHandle, user_id: String, store_id: String) -> Result<Vec<CachedProduct>, String> {
    let connection = open_database(&app)?;
    products_with_local_sales(&connection, &user_id, &store_id)
}

#[tauri::command]
pub fn cached_customers(app: tauri::AppHandle, user_id: String, store_id: String) -> Result<Vec<CachedCustomer>, String> {
    let connection = open_database(&app)?;
    let scope = format!("{user_id}:{store_id}");
    let mut statement = connection.prepare("SELECT id,first_name,last_name,phone,discount_percent FROM cached_customers WHERE store_id=?1 ORDER BY first_name,id").map_err(|error| error.to_string())?;
    let rows = statement.query_map([scope], |row| Ok(CachedCustomer { id: row.get(0)?, first_name: row.get(1)?, last_name: row.get(2)?, phone: row.get(3)?, discount_percent: row.get(4)? })).map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|error| error.to_string())
}

use rusqlite::OptionalExtension;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_discount_to_existing_customer_cache() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE cached_customers (store_id TEXT NOT NULL,id TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT,phone TEXT NOT NULL,PRIMARY KEY (store_id,id)); INSERT INTO cached_customers (store_id,id,first_name,phone) VALUES ('store-a','customer-a','Anna','+998901234567');").unwrap();
        initialize(&db).unwrap();
        let rate: String = db.query_row("SELECT discount_percent FROM cached_customers WHERE id='customer-a'", [], |row| row.get(0)).unwrap();
        assert_eq!(rate, "0");
    }

    #[test]
    fn adds_brand_and_category_to_existing_product_cache() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE cached_products (store_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,sku TEXT NOT NULL,barcodes_json TEXT NOT NULL,price_minor INTEGER,available_quantity INTEGER NOT NULL,active INTEGER NOT NULL,PRIMARY KEY (store_id,id)); INSERT INTO cached_products (store_id,id,name,sku,barcodes_json,price_minor,available_quantity,active) VALUES ('store-a','product-a','Cream','A','[]',100,3,1);").unwrap();
        initialize(&db).unwrap();
        let fields: (Option<String>, Option<String>) = db.query_row("SELECT brand_id,category_id FROM cached_products WHERE id='product-a'", [], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        assert_eq!(fields, (None, None));
    }

    #[test]
    fn snapshot_replacement_is_atomic_and_scoped_to_store() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let first = CatalogSnapshot { user_id: "user-a".into(), store_id: "store-a".into(), products: vec![CachedProduct { id: "product-a".into(), name: "Cream".into(), sku: "A".into(), brand_id: None, category_id: None, barcodes: vec!["123".into()], price_minor: Some(100), available_quantity: 3, active: true }], customers: vec![], permissions: vec!["sales.create".into()] };
        replace_snapshot(&mut db, &first).unwrap();
        assert_eq!(status(&db, "user-a", "store-a").unwrap().product_count, 1);
        let invalid = CatalogSnapshot { user_id: "user-a".into(), store_id: "store-a".into(), products: vec![CachedProduct { available_quantity: -1, ..first.products[0].clone() }], customers: vec![], permissions: vec![] };
        assert!(replace_snapshot(&mut db, &invalid).is_err());
        assert_eq!(status(&db, "user-a", "store-a").unwrap().product_count, 1);
        let other = CatalogSnapshot { user_id: "user-b".into(), store_id: "store-a".into(), products: first.products.clone(), customers: vec![], permissions: vec![] };
        replace_snapshot(&mut db, &other).unwrap();
        assert_eq!(status(&db, "user-a", "store-a").unwrap().product_count, 1);
        assert_eq!(status(&db, "user-b", "store-a").unwrap().product_count, 1);
    }

    #[test]
    fn cached_quantity_reserves_queued_and_recently_synced_sales() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let snapshot = CatalogSnapshot { user_id: "user-a".into(), store_id: "store-a".into(), products: vec![CachedProduct { id: "product-a".into(), name: "Cream".into(), sku: "A".into(), brand_id: None, category_id: None, barcodes: vec![], price_minor: Some(100), available_quantity: 3, active: true }], customers: vec![], permissions: vec![] };
        replace_snapshot(&mut db, &snapshot).unwrap();
        db.execute("UPDATE cache_meta SET last_synced_at='2020-01-01T00:00:00.000Z'", []).unwrap();
        db.execute("INSERT INTO sync_queue (operation_id,scope_key,entity_type,entity_id,payload_json,status) VALUES ('op-1','user-a:store-a','SALE','op-1','{\"operationId\":\"op-1\",\"items\":[{\"productId\":\"product-a\",\"quantity\":1}]}','ERROR')", []).unwrap();
        db.execute("INSERT INTO sync_queue (operation_id,scope_key,entity_type,entity_id,payload_json,status) VALUES ('op-2','user-a:store-a','SALE','op-2','{\"operationId\":\"op-2\",\"items\":[{\"productId\":\"product-a\",\"quantity\":1}]}','SYNCED')", []).unwrap();
        assert_eq!(products_with_local_sales(&db, "user-a", "store-a").unwrap()[0].available_quantity, 1);
        db.execute("UPDATE cache_meta SET last_synced_at='9999-01-01T00:00:00.000Z'", []).unwrap();
        assert_eq!(products_with_local_sales(&db, "user-a", "store-a").unwrap()[0].available_quantity, 2);
    }
}
