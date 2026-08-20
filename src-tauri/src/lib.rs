mod content;
mod engine_settings;
mod game_files;
mod install;
mod launch;
mod relay;
mod apps;
mod scenario;
mod profile;
mod zkcontent;
mod zkweb;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(relay::Relay::default())
        .manage(launch::Game::default())
        .manage(content::Content::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            zkcontent::zks_find_maps,
            zkcontent::zks_game_modes,
            zkcontent::zks_map_catalogue,
            apps::zka_catalogue,
            apps::zka_status,
            apps::zka_install,
            apps::zka_launch,
            apps::zka_uninstall,
            profile::zkp_profile,
            scenario::zksc_script,
            scenario::zksc_problems,
            scenario::zksc_test,
            zkweb::zkw_profile,
            zkweb::zkw_ratings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
