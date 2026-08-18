mod install;
mod launch;
mod relay;

pub fn run() {
    tauri::Builder::default()
        .manage(relay::Relay::default())
        .manage(launch::Game::default())
        .invoke_handler(tauri::generate_handler![
            relay::zks_connect,
            relay::zks_send,
            relay::zks_disconnect,
            relay::zks_password_hash,
            launch::zks_locate_install,
            launch::zks_launch_spring,
            launch::zks_launch_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
