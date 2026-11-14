mod vitals;

use std::time::{SystemTime, UNIX_EPOCH};

/// Called from the UI (`invoke("get_mission_snapshot")`) every 2 seconds.
#[tauri::command]
fn get_mission_snapshot() -> vitals::MissionSnapshot {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(vitals::MISSION_START_UNIX);
    vitals::snapshot(now)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_mission_snapshot])
        .run(tauri::generate_context!())
        .expect("error while running boops Space");
}
