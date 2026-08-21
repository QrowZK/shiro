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
//!
//! The screen is three files, not one: the addon and the two pictures it draws.
//! They are installed and removed together, because an addon that reaches for a
//! texture nobody placed is worse than no addon at all.

use std::path::{Path, PathBuf};

/// The addon itself, compiled in rather than shipped beside the binary: it is a
/// few kilobytes and having it in the executable means there is no resource to
/// go missing.
const ADDON: &str = include_str!("loadscreen/main.lua");

/// The two pictures, white on transparent so the addon can tint them with
/// `gl.Color` rather than needing a file per state.
///
/// Bytes rather than text, so `include_bytes!` rather than `include_str!` -
/// same reasoning as the addon, and the same reason the release build does not
/// have to carry a resource directory around.
///
/// Both are built by `tools/gen-loadscreen-art.mjs` from art the client already
/// ships, and both are named with a `shiro-` prefix on purpose: `LuaIntro/Images`
/// is a directory the game also reads, and removal deletes these names without
/// asking, so they had better be names nothing else would choose.
const IMAGES: [(&str, &[u8]); 2] = [
    ("shiro-mark.png", include_bytes!("loadscreen/shiro-mark.png")),
    (
        "shiro-glaive-plate.png",
        include_bytes!("loadscreen/shiro-glaive-plate.png"),
    ),
];

/// Where the file goes, relative to a data directory.
///
/// `LuaIntro/addons/main.lua` deliberately matches the name Zero-K uses, since
/// replacing that addon is the point - a second addon with a different name
/// would draw on top of the original rather than instead of it.
pub fn path(root: &Path) -> PathBuf {
    root.join("LuaIntro").join("addons").join("main.lua")
}

/// Where a picture goes. `LuaIntro/Images` is the directory the addon's
/// `gl.Texture("LuaIntro/Images/…")` resolves against.
fn image(root: &Path, name: &str) -> PathBuf {
    root.join("LuaIntro").join("Images").join(name)
}

/// Is the addon at that path one Shiro wrote?
fn ours(root: &Path) -> bool {
    std::fs::read_to_string(path(root))
        .map(|t| t.contains("Shiro's loading screen"))
        .unwrap_or(false)
}

/// Is Shiro's screen in place here, all of it?
///
/// The pictures count. A version of Shiro that predates them left the addon
/// behind without them, and reporting that as installed would leave the switch
/// saying yes while the screen drew with two textures missing.
pub fn installed(root: &Path) -> bool {
    ours(root) && IMAGES.iter().all(|(name, _)| image(root, name).is_file())
}

/// Write it, replacing anything already at those paths.
pub fn install(root: &Path) -> Result<(), String> {
    let file = path(root);
    write(&file, ADDON.as_bytes())?;
    for (name, bytes) in IMAGES {
        write(&image(root, name), bytes)?;
    }
    Ok(())
}

fn write(file: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    std::fs::write(file, bytes).map_err(|e| format!("could not write {}: {e}", file.display()))
}

/// Remove it, which restores Zero-K's own screen.
///
/// Only ever files this wrote: the check reads the addon first, so a hand-made
/// one at that path is left alone rather than deleted by a launcher that assumed
/// it put it there.
pub fn remove(root: &Path) -> Result<(), String> {
    let file = path(root);
    if file.exists() {
        if !ours(root) {
            return Err(format!(
                "{} was not written by Shiro, so it will not be removed.",
                file.display()
            ));
        }
        std::fs::remove_file(&file)
            .map_err(|e| format!("could not remove {}: {e}", file.display()))?;
    }
    /* The pictures go too, and go even when the addon has already been deleted
       by hand. That case is the whole reason this is not inside the branch
       above: nothing else in the data directory knows those two files are ours,
       so if this does not clear them, nothing ever will. */
    for (name, _) in IMAGES {
        let picture = image(root, name);
        if picture.exists() {
            std::fs::remove_file(&picture)
                .map_err(|e| format!("could not remove {}: {e}", picture.display()))?;
        }
    }
    /* And the directories, if this is all that was in them. `remove_dir`
       refuses a directory that still has something in it, which is exactly the
       question worth asking: anything left is somebody else's. */
    let luaintro = root.join("LuaIntro");
    let _ = std::fs::remove_dir(luaintro.join("Images"));
    let _ = std::fs::remove_dir(luaintro.join("addons"));
    let _ = std::fs::remove_dir(&luaintro);
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

    fn bytes_of(name: &str) -> &'static [u8] {
        IMAGES.iter().find(|(n, _)| *n == name).unwrap().1
    }

    /// Width and height out of a PNG's IHDR, which is always its first chunk.
    fn png_size(bytes: &[u8]) -> (u32, u32) {
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "not a PNG");
        assert_eq!(&bytes[12..16], b"IHDR", "IHDR is not the first chunk");
        let at = |i: usize| u32::from_be_bytes(bytes[i..i + 4].try_into().unwrap());
        (at(16), at(20))
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
    fn the_pictures_land_beside_it_unaltered() {
        // The addon draws them by name out of LuaIntro/Images, and a texture
        // that does not resolve is a picture that silently is not there.
        let root = temp("pictures");
        install(&root).unwrap();
        for (name, bytes) in IMAGES {
            let file = root.join("LuaIntro").join("Images").join(name);
            assert_eq!(std::fs::read(&file).unwrap(), bytes, "{name} was altered");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_addon_without_its_pictures_is_not_installed() {
        /* What an install made by a Shiro that predated the pictures looks
           like. It has to read as not-installed, or the switch says yes and the
           screen draws with nothing in it. */
        let root = temp("halfway");
        install(&root).unwrap();
        std::fs::remove_file(root.join("LuaIntro").join("Images").join("shiro-mark.png")).unwrap();
        assert!(!installed(&root));
        // And installing again is what puts it right.
        install(&root).unwrap();
        assert!(installed(&root));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn removing_it_puts_the_stock_screen_back() {
        let root = temp("remove");
        install(&root).unwrap();
        remove(&root).unwrap();
        assert!(!path(&root).exists());
        // Everything it wrote, not just the file it is named after.
        for (name, _) in IMAGES {
            assert!(!root.join("LuaIntro").join("Images").join(name).exists());
        }
        assert!(!root.join("LuaIntro").exists(), "an empty LuaIntro was left behind");
        // Removing what is not there is not an error - it is the desired state.
        remove(&root).unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn removal_leaves_a_directory_that_is_not_only_ours() {
        // remove_dir refusing a non-empty directory is the check, not an
        // accident: somebody else's file in there means the folder is not ours
        // to tidy away.
        let root = temp("shared");
        install(&root).unwrap();
        let theirs = root.join("LuaIntro").join("Images").join("someone-elses.png");
        std::fs::write(&theirs, b"not ours").unwrap();
        remove(&root).unwrap();
        assert!(theirs.is_file());
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

    #[test]
    fn the_addon_asks_for_the_pictures_by_the_names_they_are_written_under() {
        /* The two sides of this are a Lua string and a Rust constant, and
           nothing else connects them. Renaming one and not the other costs two
           textures at runtime and nothing at compile time, which is exactly the
           kind of silence this repo has been bitten by before. */
        for (name, _) in IMAGES {
            assert!(ADDON.contains(name), "the addon never mentions {name}");
        }
    }

    #[test]
    fn the_pictures_are_the_shape_the_addon_draws() {
        assert_eq!(png_size(bytes_of("shiro-mark.png")), (256, 256));
        assert_eq!(png_size(bytes_of("shiro-glaive-plate.png")), (807, 1400));
        /* The plate's aspect is a literal in the Lua, because the addon cannot
           ask a texture how big it is before it has drawn it. If the art is
           ever regenerated at another size, that number has to move with it or
           the Glaive is quietly stretched. */
        assert!(ADDON.contains("807 / 1400"));
    }
}
