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
//!   That is also why the source repository is not printed in the launcher: the
//!   entry cannot have come from anywhere else, so naming it told the user
//!   nothing they could act on.
//! - **Downloads are verified against a hash pinned in that catalogue**, and
//!   land in Shiro's own app directory rather than anywhere the user browses to.
//! - **Nothing is ever launched that the user did not just ask to launch.** No
//!   run-after-install, no autostart.
//!
//! Everything in the catalogue is a separate program. Splaunch and Sprofiler
//! started as screens in here and were taken out: a scenario editor has nothing
//! to do with a lobby, and a lobby should not have to carry one.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// How an app is delivered.
///
/// Only one variant today, and it is kept rather than removed because "what
/// kind of thing is this" is the question the launcher will have to answer
/// again the moment something arrives that is not a Windows executable.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppKind {
    /// A program we download and start.
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

/// The catalogue: the tools Shiro can install and run.
///
/// All of them are separate programs with their own repositories. Splaunch and
/// Sprofiler began life as screens in here and were taken out - a scenario
/// editor has nothing to do with a lobby, and a lobby should not have to carry
/// one. What is left is a launcher, which is a smaller and more honest thing.
pub const CATALOGUE: &[CatalogueApp] = &[
    CatalogueApp {
        id: "sprofiler",
        name: "Sprofiler",
        summary: "Check whether Zero-K will run well on this machine",
        description: "Zero-K performance profiling tool",
        kind: AppKind::Executable,
        download: Some(
            "https://github.com/QrowZK/Sprofiler/releases/download/dev/Sprofiler_0.1.8_x64.zip",
        ),
        sha256: Some("aea2e51a0e4f1fb9ea29457897defa7823107ff95a360ba886df24ee8e9648d6"),
        version: Some("0.1.8"),
        run: Some("Sprofiler.exe"),
        unavailable: None,
    },
    CatalogueApp {
        id: "splaunch",
        name: "Splaunch",
        summary: "Build Zero-K scenarios and play them",
        description: "Scenario editor for the Spring and Recoil RTS engines",
        kind: AppKind::Executable,
        download: Some(
            "https://github.com/QrowZK/Splaunch/releases/download/dev/Splaunch_0.1.9_x64.zip",
        ),
        sha256: Some("67938ce82b0f147657a28d3e188d284ff9406eeaa59095c12a8dab57e9908ed4"),
        version: Some("0.1.9"),
        run: Some("Splaunch.exe"),
        unavailable: None,
    },
    CatalogueApp {
        id: "springen",
        name: "Springen",
        summary: "Node-graph map generator for Spring and Zero-K",
        description: "Node-based map generator tool for Zero-K",
        kind: AppKind::Executable,
        download: Some(
            "https://github.com/QrowZK/Springen/releases/download/dev/Springen_0.1.1_x64.zip",
        ),
        // Verified by hand against the downloaded file, not copied from the
        // release notes: this value is what decides whether the bytes are
        // allowed to become a program, so it is worth checking rather than
        // trusting the thing it is meant to check.
        sha256: Some("99e5b950937719056052aff1258ca28054733d3a37fa5a2386ecf174a05335ea"),
        version: Some("0.1.1"),
        run: Some("springen-app.exe"),
        unavailable: None,
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

/// Only these hosts may be fetched from, whatever the catalogue says.
///
/// The catalogue is compiled in, so this is belt and braces - but it is the
/// belt that stops a bad edit becoming a download from anywhere.
fn host_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host).to_ascii_lowercase();
    host == "github.com"
        || host.ends_with(".github.com")
        || host == "objects.githubusercontent.com"
}

fn sha256_of(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Unpack a zip into `dir`, refusing any entry that would land outside it.
///
/// A zip is a list of paths somebody else chose, and `../../` in one of them is
/// the oldest trick there is.
fn unpack(bytes: &[u8], dir: &Path) -> Result<(), String> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("not a zip: {e}"))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("unreadable entry: {e}"))?;
        let Some(rel) = file.enclosed_name() else {
            return Err(format!("refusing an unsafe path in the archive: {}", file.name()));
        };
        let target = dir.join(rel);
        if !target.starts_with(dir) {
            return Err(format!("refusing an entry outside the app directory: {}", file.name()));
        }
        if file.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| format!("{}: {e}", target.display()))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        let mut out =
            std::fs::File::create(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        std::io::copy(&mut file, &mut out).map_err(|e| format!("{}: {e}", target.display()))?;
    }
    Ok(())
}

/// Download an app, check it against the hash in the catalogue, and unpack it.
///
/// The hash is the point. The download is over HTTPS from a host we allow, but
/// it is the hash that decides whether the bytes get to become a program on
/// somebody's machine - so a mismatch deletes what it fetched and says so.
#[tauri::command]
pub fn zka_install(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let a = entry(&id)?;
    if let Some(why) = a.unavailable {
        return Err(why.to_string());
    }
    let (url, want) = match (a.download, a.sha256) {
        (Some(u), Some(h)) => (u, h),
        _ => return Err(format!("{} has nothing to install", a.name)),
    };
    if !host_allowed(url) {
        return Err(format!("refusing to fetch {url}"));
    }

    let res = reqwest::blocking::Client::builder()
        .user_agent(concat!("Shiro/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))?
        .get(url)
        .send()
        .map_err(|e| format!("could not reach {url}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("{url} answered {}", res.status()));
    }
    let bytes = res.bytes().map_err(|e| format!("download failed: {e}"))?;

    let got = sha256_of(&bytes);
    if !got.eq_ignore_ascii_case(want) {
        return Err(format!(
            "{} did not match its published hash and was discarded - expected {want}, got {got}",
            a.name
        ));
    }

    let dir = app_dir(&app, a.id)?;
    // A half-unpacked previous attempt is not an install.
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("could not clear {}: {e}", dir.display()))?;
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    unpack(&bytes, &dir)?;

    if let Some(v) = a.version {
        let _ = std::fs::write(dir.join("installed-version"), v);
    }
    Ok(())
}

/// Remove an installed app. Its own directory, and nothing above it.
#[tauri::command]
pub fn zka_uninstall(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let a = entry(&id)?;
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
    fn only_github_is_fetchable() {
        assert!(host_allowed("https://github.com/QrowZK/Springen/releases/download/v1/x.zip"));
        assert!(host_allowed("https://objects.githubusercontent.com/x"));
        assert!(!host_allowed("https://github.com.evil.example/x"));
        assert!(!host_allowed("https://example.com/x"));
        // Userinfo is the classic way to make a URL look like somewhere else.
        assert!(!host_allowed("https://github.com@evil.example/x"));
        // Plain HTTP is not a download we would trust even with a hash.
        assert!(!host_allowed("http://github.com/x"));
    }

    #[test]
    fn a_zip_cannot_write_outside_the_app_directory() {
        // The oldest trick there is, and the one that turns "install an app"
        // into "overwrite anything this process can reach".
        let dir = std::env::temp_dir().join("shiro-test-unpack");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            w.start_file("../escaped.txt", opts).unwrap();
            use std::io::Write;
            w.write_all(b"nope").unwrap();
            w.finish().unwrap();
        }

        let err = unpack(&buf, &dir).unwrap_err();
        assert!(err.contains("refusing"), "{err}");
        assert!(!dir.parent().unwrap().join("escaped.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_normal_zip_unpacks() {
        let dir = std::env::temp_dir().join("shiro-test-unpack-ok");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            w.start_file("bin/app.exe", opts).unwrap();
            use std::io::Write;
            w.write_all(b"MZ").unwrap();
            w.finish().unwrap();
        }

        unpack(&buf, &dir).unwrap();
        assert_eq!(std::fs::read(dir.join("bin/app.exe")).unwrap(), b"MZ");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_hash_is_of_the_bytes() {
        // A known vector, so a change of algorithm is a failing test rather
        // than every future download being rejected.
        assert_eq!(
            sha256_of(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for a in CATALOGUE {
            assert!(seen.insert(a.id), "duplicate app id {}", a.id);
        }
    }
}
