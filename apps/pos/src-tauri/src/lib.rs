use std::io::Write;
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::time::Duration;
mod local_cache;
mod offline_session;
mod sync_queue;

#[tauri::command]
fn print_escpos(host: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > 65_536 {
        return Err("Invalid receipt size".into());
    }
    let ip: IpAddr = host.parse().map_err(|_| "Enter a valid printer IP address")?;
    let address = SocketAddr::new(ip, 9100);
    let mut printer = TcpStream::connect_timeout(&address, Duration::from_secs(5))
        .map_err(|error| format!("Cannot connect to receipt printer: {error}"))?;
    printer.set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    printer.write_all(&bytes).map_err(|error| error.to_string())?;
    printer.flush().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![print_escpos, local_cache::save_catalog_snapshot, local_cache::catalog_cache_status, local_cache::cached_products, local_cache::cached_customers, local_cache::database_health, offline_session::save_offline_session, offline_session::save_offline_code_session, offline_session::mark_offline_session_ready, offline_session::read_offline_session, offline_session::read_offline_code_sessions, offline_session::clear_offline_session, sync_queue::enqueue_sale, sync_queue::list_sync_queue, sync_queue::sync_queue_summary, sync_queue::set_sync_status, sync_queue::retry_conflict_sale])
        .run(tauri::generate_context!())
        .expect("error while running Korea CRM POS");
}
