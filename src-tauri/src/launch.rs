//! Handing a battle off to the Spring engine.
//!
//! The server hosts the game; all we do is write the eight-line connect script
//! it implies and start the engine pointed at it (docs/ARCHITECTURE.md
//! section 6). Everything up to the spawn is pure so it can be tested without
//! an engine on the machine.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::install::{self, Install};

/// Game process lifecycle, mirrored to the UI.
const GAME_EVENT: &str = "zks://game";

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GameStatus {
    Launched { pid: u32 },
    Exited { code: Option<i32> },
    Failed { reason: String },
}

/// The fields of `ConnectSpring` that actually reach the engine.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    pub engine: String,
    pub ip: String,
    pub port: u16,
    pub my_player_name: String,
    pub script_password: String,
}

/// Spring's script format is unquoted and `;`-terminated, so a value containing
/// a delimiter would silently produce a different script rather than an error.
/// Server-issued names and passwords never contain these; reject rather than
/// mangle, so a protocol change surfaces as a message instead of a broken join.
fn check_value(field: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{field} is empty"));
    }
    if let Some(bad) = value.chars().find(|c| matches!(c, ';' | '}' | '{' | '\n' | '\r')) {
        return Err(format!(
            "{field} contains {bad:?}, which the engine script cannot represent"
        ));
    }
    Ok(())
}

/// The entire connect script, per `ScriptGenerator.cs:22-34`.
pub fn connect_script(req: &ConnectRequest) -> Result<String, String> {
    check_value("host address", &req.ip)?;
    check_value("player name", &req.my_player_name)?;
    check_value("script password", &req.script_password)?;
    Ok(format!(
        "[GAME]\n\
         {{\n\
         HostIP={};\n\
         HostPort={};\n\
         IsHost=0;\n\
         MyPlayerName={};\n\
         MyPasswd={};\n\
         }}\n",
        req.ip, req.port, req.my_player_name, req.script_password
    ))
}

/// Everything needed to start the engine, resolved but not yet executed.
#[derive(Debug, PartialEq, Eq)]
pub struct SpawnPlan {
    pub exe: PathBuf,
    pub cwd: PathBuf,
    pub args: Vec<OsString>,
    pub env: Vec<(String, OsString)>,
}

/// Build the command line.
///
/// The data dir is passed through the environment rather than a flag: engine
/// versions disagree about the spelling of the write-dir option, and an
/// unrecognised flag aborts startup, whereas `SPRING_DATADIR` has been stable
/// for a decade. Without it the engine writes to the user's Documents folder
/// and finds none of the installed games or maps.
pub fn spawn_plan(exe: &Path, root: &Path, script: &Path) -> SpawnPlan {
    let mut args: Vec<OsString> = Vec::new();
    let config = root.join("springsettings.cfg");
    if config.is_file() {
        args.push("--config".into());
        args.push(config.into_os_string());
    }
    args.push(script.as_os_str().to_os_string());
    SpawnPlan {
        exe: exe.to_path_buf(),
        cwd: exe.parent().unwrap_or(root).to_path_buf(),
        args,
        env: vec![
            ("SPRING_DATADIR".into(), root.as_os_str().to_os_string()),
            ("SPRING_WRITEDIR".into(), root.as_os_str().to_os_string()),
        ],
    }
}

/// Where the connect script is written.
///
/// Deliberately not inside the Zero-K folder: a Steam install under
/// `Program Files` is not writable by a per-user process, and failing to launch
/// because of that would be a maddening bug to diagnose.
pub fn script_path() -> PathBuf {
    std::env::temp_dir().join("shiro").join("connect_script.txt")
}

/// One running game at a time. Zero-K itself is single-instance and two engines
/// fighting over the same write dir corrupts the config.
#[derive(Default)]
pub struct Game {
    running: Arc<Mutex<bool>>,
    /// A path from settings, if the player keeps Zero-K somewhere unusual.
    root: Arc<Mutex<Option<String>>>,
}

/// What a launch would do, resolved but not run.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPreview {
    pub install: Install,
    pub exe: PathBuf,
    pub cwd: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub script_path: PathBuf,
    pub script: String,
}

/// Resolve everything a launch needs and report it, without starting anything.
///
/// The launch is the one part of this client that cannot be exercised without a
/// Zero-K install and a real match, so the first time it runs it had better not
/// be a blank failure. This answers "would it work, and with what" from the
/// settings screen, where the fix - a wrong install path, a missing engine - is
/// two fields away.
#[tauri::command]
pub fn zks_launch_preview(
    game: State<'_, Game>,
    engine: String,
    player: String,
) -> Result<LaunchPreview, String> {
    let root = game.root.lock().ok().and_then(|r| r.clone());
    let install = install::detect_with(root.as_deref())?;
    let exe = install::find_engine(&install.root, &engine)?;
    let script_path = script_path();
    // Placeholder connect details: the point is the paths and the shape of the
    // script, not the address of a game that is not running.
    let req = ConnectRequest {
        engine,
        ip: "0.0.0.0".into(),
        port: 0,
        my_player_name: player,
        script_password: "preview".into(),
    };
    let script = connect_script(&req)?;
    let plan = spawn_plan(&exe, &install.root, &script_path);
    Ok(LaunchPreview {
        install,
        exe: plan.exe,
        cwd: plan.cwd,
        args: plan.args.iter().map(|a| a.to_string_lossy().into_owned()).collect(),
        env: plan.env.iter()
            .map(|(k, v)| (k.clone(), v.to_string_lossy().into_owned()))
            .collect(),
        script_path,
        script,
    })
}

#[tauri::command]
pub fn zks_locate_install(game: State<'_, Game>, root: Option<String>) -> Result<Install, String> {
    // The override is remembered so a launch uses the same install the settings
    // screen just confirmed, without having to pass it through ConnectSpring.
    if let Ok(mut r) = game.root.lock() {
        *r = root.clone().filter(|s| !s.trim().is_empty());
    }
    install::detect_with(root.as_deref())
}

/// Write the script and start the engine. Returns once the process has been
/// spawned; the exit arrives later on `zks://game`.
#[tauri::command]
pub fn zks_launch_spring(
    app: AppHandle,
    game: State<'_, Game>,
    req: ConnectRequest,
) -> Result<u32, String> {
    {
        let mut running = game
            .running
            .lock()
            .map_err(|_| "game state poisoned".to_string())?;
        if *running {
            return Err("A game is already running.".into());
        }
        *running = true;
    }

    let root = game.root.lock().ok().and_then(|r| r.clone());
    let mut child = match start(&req, root.as_deref()) {
        Ok(child) => child,
        Err(e) => {
            if let Ok(mut r) = game.running.lock() {
                *r = false;
            }
            let _ = app.emit(GAME_EVENT, GameStatus::Failed { reason: e.clone() });
            return Err(e);
        }
    };

    let pid = child.id();
    let _ = app.emit(GAME_EVENT, GameStatus::Launched { pid });

    // Supervise off-thread: the engine owns the screen for the length of a
    // match, and the lobby has to come back by itself when it exits.
    let running = game.running.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        if let Ok(mut r) = running.lock() {
            *r = false;
        }
        let _ = app.emit(GAME_EVENT, GameStatus::Exited { code });
    });

    Ok(pid)
}

/// Resolve install and engine, write the script, spawn.
fn start(req: &ConnectRequest, root: Option<&str>) -> Result<std::process::Child, String> {
    let install = install::detect_with(root)?;
    let exe = install::find_engine(&install.root, &req.engine)?;
    let script = script_path();
    if let Some(dir) = script.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    std::fs::write(&script, connect_script(req)?)
        .map_err(|e| format!("cannot write {}: {e}", script.display()))?;

    let plan = spawn_plan(&exe, &install.root, &script);
    let mut cmd = Command::new(&plan.exe);
    cmd.current_dir(&plan.cwd).args(&plan.args);
    for (k, v) in &plan.env {
        cmd.env(k, v);
    }
    cmd.spawn()
        .map_err(|e| format!("cannot start {}: {e}", plan.exe.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> ConnectRequest {
        ConnectRequest {
            engine: "2025.06.21".into(),
            ip: "128.0.0.1".into(),
            port: 8452,
            my_player_name: "Qrow".into(),
            script_password: "sp-9f2c".into(),
        }
    }

    #[test]
    fn writes_the_script_upstream_specifies() {
        assert_eq!(
            connect_script(&req()).unwrap(),
            "[GAME]\n{\nHostIP=128.0.0.1;\nHostPort=8452;\nIsHost=0;\n\
             MyPlayerName=Qrow;\nMyPasswd=sp-9f2c;\n}\n"
        );
    }

    #[test]
    fn never_hosts() {
        assert!(connect_script(&req()).unwrap().contains("IsHost=0;"));
    }

    #[test]
    fn refuses_values_that_would_forge_a_different_script() {
        let mut r = req();
        r.script_password = "x;EnableLag=1".into();
        let err = connect_script(&r).unwrap_err();
        assert!(err.contains("script password"), "{err}");

        let mut r = req();
        r.my_player_name = "a\nb".into();
        assert!(connect_script(&r).is_err());
    }

    #[test]
    fn refuses_empty_values() {
        let mut r = req();
        r.script_password = String::new();
        assert!(connect_script(&r).unwrap_err().contains("empty"));
    }

    #[test]
    fn the_engine_runs_from_its_own_folder_with_the_zk_data_dir() {
        let plan = spawn_plan(
            Path::new("/zk/engine/linux64/2025.06.21/spring"),
            Path::new("/zk"),
            Path::new("/tmp/shiro/connect_script.txt"),
        );
        assert_eq!(plan.cwd, Path::new("/zk/engine/linux64/2025.06.21"));
        assert_eq!(plan.args, vec![OsString::from("/tmp/shiro/connect_script.txt")]);
        assert!(plan
            .env
            .iter()
            .any(|(k, v)| k == "SPRING_DATADIR" && v == "/zk"));
    }

    #[test]
    fn the_script_never_lands_inside_the_install() {
        // A Steam install under Program Files is read-only for a per-user process.
        assert!(script_path().starts_with(std::env::temp_dir()));
    }
}
