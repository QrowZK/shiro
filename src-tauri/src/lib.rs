mod relay;

pub fn run() {
    tauri::Builder::default()
        .manage(relay::Relay::default())
        .invoke_handler(tauri::generate_handler![
            relay::zks_connect,
            relay::zks_send,
            relay::zks_disconnect,
            relay::zks_password_hash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
