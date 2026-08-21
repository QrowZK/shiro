mod ais;
mod archives;
mod content;
mod engine;
mod engine_settings;
mod game_files;
mod install;
mod launch;
mod loadscreen;
mod managed;
mod relay;
mod sidecar;
mod apps;
mod zkcontent;
mod zkweb;

pub fn run() {
    tauri::Builder::default()
        /* Bundled apps are put in place before the window opens, so the
           launcher's first paint is already the truth. A failure here is not
           worth refusing to start the lobby over - the app simply shows as not
           installed, which is what it is. */
        .setup(|app| {
            managed::seed_loadscreen(app.handle());
            if let Err(e) = apps::seed_bundled(app.handle()) {
                eprintln!("could not place the bundled apps: {e}");
            }
            Ok(())
        })
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
            content::zks_content_log,
            ais::zks_list_ais,
            zkcontent::zks_find_maps,
            zkcontent::zks_game_modes,
            zkcontent::zks_map_catalogue,
            managed::zks_managed_root,
            managed::zks_managed_state,
            managed::zks_managed_prepare,
            managed::zks_managed_install_engine,
            managed::zks_managed_remove,
            managed::zks_loadscreen_state,
            managed::zks_loadscreen_set,
            apps::zka_catalogue,
            apps::zka_status,
            apps::zka_install,
            apps::zka_launch,
            apps::zka_uninstall,
            zkweb::zkw_profile,
            zkweb::zkw_ratings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
