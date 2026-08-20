//! The app launcher: a small, curated set of tools Shiro can install and run.
//!
//! Not a plugin host and not a marketplace. `docs/APPS.md` has the reasoning;
//! the short version is that nothing here runs inside Shiro's webview, so none
//! of the sandboxing problems in `docs/PLUGINS.md` apply. What applies instead
//! is that we are downloading executables and running them, which deserves more
//! care than a plugin would, not less:
//!
//! - **The catalogue ships with Shiro.** It is the constant below, not a URL.
//!   Nobody can add an entry by serving a file; adding one is a pull request.
//! - **Downloads are verified against a hash pinned in that catalogue**, and
//!   land in Shiro's own app directory rather than anywhere the user browses to.
//! - **Nothing is ever launched that the user did not just ask to launch.** No
//!   run-after-install, no autostart.
//!
//! An app that Shiro itself provides - the profiler, Splaunch - is in the same
//! list with `kind: Builtin`, so the launcher is one list rather than two.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// How an app is delivered, which decides what "install" and "launch" mean.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppKind {
    /// A screen inside Shiro. Nothing to fetch, nothing to run.
    Builtin,
    /// A program we download and start. The one that needs the care above.
    Executable,
}

/// One entry in the catalogue.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueApp {
    pub id: &'static str,
    pub name: &'static str,
    pub summary: &'static str,
    pub description: &'static str,
    pub kind: AppKind,
    /// Where it comes from, shown to the user before they agree to fetch it.
    pub source: &'static str,
    /// None when there is nothing published yet - see `unavailable`.
    pub download: Option<&'static str>,
    /// SHA-256 of the download, lowercase hex. Absent only when `download` is.
    pub sha256: Option<&'static str>,
    pub version: Option<&'static str>,
    /// The file to run once installed, relative to the app's directory.
    pub run: Option<&'static str>,
    /// Set when the app cannot be installed at all, and says why in a sentence
    /// a person can act on. A row that is merely broken is the failure to avoid.
    pub unavailable: Option<&'static str>,
}

/// The catalogue. Four entries, hand-written, shipped in the binary.
pub const CATALOGUE: &[CatalogueApp] = &[
    CatalogueApp {
        id: "profiler",
        name: "System profiler",
        summary: "Check whether Zero-K will run well on this machine",
        description: "Reads what the engine saw the last time it ran - processor, \
graphics card, video memory, OpenGL version - and recommends a settings preset. \
Catches the two failures that actually stop people playing: a software renderer, \
and an OpenGL version too old for the game.",
        kind: AppKind::Builtin,
        source: "Shiro",
        download: None,
        sha256: None,
        version: None,
        run: None,
        unavailable: None,
    },
    CatalogueApp {
        id: "splaunch",
        name: "Splaunch",
        summary: "Build Zero-K scenarios and play them",
        description: "Place units and features on a map, give them orders, set \
objectives, and press Test to launch straight into it. Scenarios are start \
scripts, so Test is the real game rather than a preview.",
        kind: AppKind::Builtin,
        source: "Shiro",
        download: None,
        sha256: None,
        version: None,
        run: None,
        unavailable: None,
    },
    CatalogueApp {
        id: "springen",
        name: "Springen",
        summary: "Node-graph map generator for Spring and Zero-K",
        description: "Authors terrain as a graph of resolution-independent fields \
and writes a finished .sd7 - heightmap, textures, metal spots and start boxes - \
without mapconv. Opens in its own window.",
        kind: AppKind::Executable,
        source: "github.com/QrowZK/Springen",
        download: None,
        sha256: None,
        version: None,
        run: Some("springen-app.exe"),
        // Measured 2026-08-20: the repository has no releases. Until it
        // publishes one there is nothing to fetch, and saying so is better than
        // an Install button that fails.
        unavailable: Some("No build published yet - Springen has no releases."),
    },
    CatalogueApp {
        id: "springboard",
        name: "SpringBoard",
        summary: "The existing Spring scenario editor",
        description: "Runs on the Spring engine. Distributed as its own installer \
with separate assets; Shiro can point you at it but does not manage it.",
        kind: AppKind::Executable,
        source: "github.com/Spring-SpringBoard/SpringBoard-Core",
        download: None,
        sha256: None,
        version: None,
        run: None,
        unavailable: Some("Not managed by Shiro yet - install it from its own release page."),
    },
];

/// What the launcher shows for one app: the catalogue entry plus what is true
/// of it on this machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub id: String,
    pub installed: bool,
    /// The version on disk, when we recorded one.
    pub installed_version: Option<String>,
    pub path: Option<String>,
}

/// Where installed apps live: Shiro's own data directory, never the Zero-K one.
///
/// `content.rs` and `install.rs` own the Zero-K data directory and a second
/// writer is how two tools end up disagreeing about what is installed.
pub fn apps_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no data directory: {e}"))?;
    Ok(base.join("apps"))
}

fn app_dir(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("not an app id: {id:?}"));
    }
    Ok(apps_dir(app)?.join(id))
}

fn entry(id: &str) -> Result<&'static CatalogueApp, String> {
    CATALOGUE
        .iter()
        .find(|a| a.id == id)
        .ok_or_else(|| format!("no such app: {id}"))
}

/// The catalogue, as shipped.
#[tauri::command]
pub fn zka_catalogue() -> Vec<CatalogueApp> {
    CATALOGUE.to_vec()
}

/// What is installed, on this machine, right now.
///
/// Read from disk every time rather than remembered: a person who deletes the
/// directory has uninstalled it, and a launcher that disagrees is worse than
/// one that is a little slower.
#[tauri::command]
pub fn zka_status(app: tauri::AppHandle) -> Result<Vec<AppStatus>, String> {
    let mut out = Vec::new();
    for a in CATALOGUE {
        if a.kind == AppKind::Builtin {
            out.push(AppStatus {
                id: a.id.into(),
                installed: true,
                installed_version: None,
                path: None,
            });
            continue;
        }
        let dir = app_dir(&app, a.id)?;
        let exe = a.run.map(|r| dir.join(r));
        let installed = exe.as_deref().map(Path::is_file).unwrap_or(false);
        let version = std::fs::read_to_string(dir.join("installed-version"))
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        out.push(AppStatus {
            id: a.id.into(),
            installed,
            installed_version: version,
            path: exe.filter(|_| installed).map(|p| p.display().to_string()),
        });
    }
    Ok(out)
}

/// Start an installed app.
///
/// Only ever from a catalogue entry's own `run` path inside its own directory,
/// so this cannot be talked into starting something else.
#[tauri::command]
pub fn zka_launch(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let a = entry(&id)?;
    if let Some(why) = a.unavailable {
        return Err(why.to_string());
    }
    let run = a.run.ok_or_else(|| format!("{} is not something to run", a.name))?;
    let exe = app_dir(&app, a.id)?.join(run);
    if !exe.is_file() {
        return Err(format!("{} is not installed", a.name));
    }
    Command::new(&exe)
        .current_dir(exe.parent().unwrap_or(Path::new(".")))
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", a.name))?;
    Ok(())
}

/// Remove an installed app. Its own directory, and nothing above it.
#[tauri::command]
pub fn zka_uninstall(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let a = entry(&id)?;
    if a.kind == AppKind::Builtin {
        return Err(format!("{} is part of Shiro", a.name));
    }
    let dir = app_dir(&app, a.id)?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("could not remove {}: {e}", dir.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entry_is_installable_or_says_why_not() {
        for a in CATALOGUE {
            if a.kind == AppKind::Builtin {
                assert!(a.download.is_none(), "{} is built in", a.id);
                continue;
            }
            // An executable entry either has something to fetch and a hash to
            // check it against, or an explicit reason it cannot be installed.
            // Anything else is a row that fails when pressed.
            if a.unavailable.is_none() {
                assert!(a.download.is_some(), "{} has nothing to download", a.id);
                assert!(a.sha256.is_some(), "{} has no hash to verify", a.id);
                assert!(a.run.is_some(), "{} has nothing to run", a.id);
            }
        }
    }

    #[test]
    fn a_download_is_never_unverified() {
        // The hash is what stops a compromised host running code on the
        // machine, so the two travel together or not at all.
        for a in CATALOGUE {
            assert_eq!(
                a.download.is_some(),
                a.sha256.is_some(),
                "{} has one of download/sha256 without the other",
                a.id
            );
        }
    }

    #[test]
    fn ids_are_safe_as_directory_names() {
        for a in CATALOGUE {
            assert!(
                a.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
                "{} is not a safe directory name",
                a.id
            );
        }
    }

    #[test]
    fn ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for a in CATALOGUE {
            assert!(seen.insert(a.id), "duplicate app id {}", a.id);
        }
    }
}
