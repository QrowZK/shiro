# Not committed: fetched at build time

`Sprofiler.exe` is placed here by `tools/fetch-bundled-apps.mjs`, which
downloads the exact zip the catalogue in `src-tauri/src/apps.rs` pins and checks
it against the SHA-256 pinned beside it.

Reading both out of the catalogue is the point. The bundled copy and the
downloadable copy are then provably the same bytes, there is one place to change
a version, and the hash that guards the download guards the bundle too.

A build that skips the fetch simply ships no bundled copy, and Sprofiler behaves
like every other entry in the launcher: it downloads on demand.

Only the executable is copied in. The archive also contains Sprofiler's own
README, and unpacking the whole thing here once landed it on top of this file.
