//! Shiro's loading screen, placed into a data directory.
//!
//! Zero-K draws the screen between pressing start and the game appearing from
//! `luaintro/main.lua` inside its own game archive. That archive cannot be
//! touched - its checksum is what keeps a client in sync with the server - but
//! it does not have to be, because the first thing Zero-K's own script does is
//!
//! ```lua
//! VFS.DEF_MODE = VFS.RAW_FIRST
//! ```
//!
//! which searches the raw data directory before any archive. A file written to
//! `<datadir>/LuaIntro/addons/main.lua` is therefore found ahead of Zero-K's
//! addon of the same name and replaces it. Nothing is patched, nothing is
//! injected, and the game's checksum is exactly what it was.
//!
//! Two limits worth stating plainly:
//!
//! - **This rests on Zero-K's choice, not the engine's guarantee.** That
//!   `RAW_FIRST` line is in their script. If it goes, the file is simply
//!   ignored and the stock screen comes back - which is the safe way for it to
//!   fail.
//! - **Only where Shiro owns the directory.** A managed install is ours to
//!   write into. Somebody else's Steam installation is not, so this is not
//!   written there without being asked.

use std::path::{Path, PathBuf};

/// The addon itself, compiled in rather than shipped beside the binary: it is
/// two kilobytes and having it in the executable means there is no resource to
/// go missing.
const ADDON: &str = include_str!("loadscreen/main.lua");

/// Where the file goes, relative to a data directory.
///
/// `LuaIntro/addons/main.lua` deliberately matches the name Zero-K uses, since
/// replacing that addon is the point - a second addon with a different name
/// would draw on top of the original rather than instead of it.
pub fn path(root: &Path) -> PathBuf {
    root.join("LuaIntro").join("addons").join("main.lua")
}

/// Written when somebody turns the screen off, so it stays off.
///
/// A sibling of the addon rather than its absence, because absence is also what
/// a brand-new install looks like - and a launcher that cannot tell those apart
/// puts the file back every time it starts, which is the same unhelpfulness as
/// reinstalling an app the user just removed.
const OFF: &str = ".shiro-loadscreen-off";

fn off_marker(root: &Path) -> PathBuf {
    root.join(OFF)
}

/// Turned off on purpose?
pub fn declined(root: &Path) -> bool {
    off_marker(root).is_file()
}

/// Put it in place unless it is already there or somebody said no.
///
/// Runs at startup for an install Shiro owns, so the screen is on by default -
/// including for installs made before it existed, which would otherwise have
/// needed the switch found and pressed to get something the next install got
/// for free.
pub fn ensure_default(root: &Path) -> Result<(), String> {
    if declined(root) || installed(root) {
        return Ok(());
    }
    install(root)
}

/// Is Shiro's screen in place here?
pub fn installed(root: &Path) -> bool {
    std::fs::read_to_string(path(root))
        .map(|t| t.contains("Shiro's loading screen"))
        .unwrap_or(false)
}

/// Write it, replacing anything already at that path.
pub fn install(root: &Path) -> Result<(), String> {
    // Asking for it back cancels the note that said not to.
    let _ = std::fs::remove_file(off_marker(root));
    let file = path(root);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    std::fs::write(&file, ADDON).map_err(|e| format!("could not write {}: {e}", file.display()))
}

/// Remove it, which restores Zero-K's own screen.
///
/// Only ever a file this wrote: the check reads the file first, so a hand-made
/// addon at that path is left alone rather than deleted by a launcher that
/// assumed it put it there.
pub fn remove(root: &Path) -> Result<(), String> {
    let file = path(root);
    if !file.exists() {
        return Ok(());
    }
    if !installed(root) {
        return Err(format!(
            "{} was not written by Shiro, so it will not be removed.",
            file.display()
        ));
    }
    std::fs::remove_file(&file)
        .map_err(|e| format!("could not remove {}: {e}", file.display()))?;
    /* And remember that it was deliberate, so startup does not helpfully put it
       back. Best-effort: failing to write the note is not a reason to refuse
       the removal the user asked for. */
    let _ = std::fs::write(off_marker(root), "Shiro's loading screen was turned off here.\n");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shiro-loadscreen-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn it_lands_where_zero_k_looks_first() {
        let root = temp("place");
        assert!(!installed(&root));
        install(&root).unwrap();
        // The path matters: it has to be the addon Zero-K also calls main, or
        // it draws alongside the original instead of replacing it.
        assert!(root.join("LuaIntro").join("addons").join("main.lua").is_file());
        assert!(installed(&root));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn removing_it_puts_the_stock_screen_back() {
        let root = temp("remove");
        install(&root).unwrap();
        remove(&root).unwrap();
        assert!(!path(&root).exists());
        // Removing what is not there is not an error - it is the desired state.
        remove(&root).unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn it_is_on_by_default_but_off_stays_off() {
        let root = temp("default");
        // A fresh managed install gets it without being asked.
        ensure_default(&root).unwrap();
        assert!(installed(&root));

        // Turning it off has to survive the next start, or the switch is a
        // suggestion rather than a setting.
        remove(&root).unwrap();
        assert!(declined(&root));
        ensure_default(&root).unwrap();
        assert!(!installed(&root), "startup put back a screen the user removed");

        // And turning it on again clears that.
        install(&root).unwrap();
        assert!(installed(&root) && !declined(&root));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn somebody_elses_addon_is_not_deleted() {
        // A launcher that deletes a file it did not write is a launcher that
        // eats somebody's work the first time they customise this themselves.
        let root = temp("theirs");
        let file = path(&root);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "-- my own load screen\n").unwrap();
        assert!(!installed(&root));
        assert!(remove(&root).is_err());
        assert!(file.is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_addon_declares_what_the_handler_needs() {
        // Loaded by name through Zero-K's addon handler, so the InGetInfo block
        // and the two callins it is loaded for have to be present.
        assert!(ADDON.contains("addon.InGetInfo"));
        assert!(ADDON.contains("function addon.DrawLoadScreen"));
        assert!(ADDON.contains("function addon.LoadProgress"));
        assert!(ADDON.contains("depend"));
    }
}
