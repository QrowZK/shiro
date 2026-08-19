mod content;
mod engine_settings;
mod game_files;
mod install;
mod launch;
mod relay;
mod zkcontent;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(relay::Relay::default())
        .manage(launch::Game::default())
        .manage(content::Content::default())
        .invoke_handler(tauri::generate_handler![
            relay::zks_connect,
            relay::zks_send,
            relay::zks_disconnect,
            relay::zks_password_hash,
            launch::zks_locate_install,
            launch::zks_launch_spring,
            launch::zks_launch_preview,
            engine_settings::zks_read_engine_settings,
            engine_settings::zks_write_engine_settings,
            game_files::zks_read_infolog,
            game_files::zks_read_lups,
            game_files::zks_write_lups,
            game_files::zks_write_cmdcolors,
            content::zks_content_fetch,
            content::zks_content_cancel,
            content::zks_content_preflight,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
