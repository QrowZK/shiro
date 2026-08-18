# NewLobby — Shiro

A new lobby client for [Zero-K](https://zero-k.info). Same functionality as the
existing client, dramatically better execution.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, wire protocol, launch pipeline, Windows packaging
- [docs/DESIGN_HANDOFF.md](docs/DESIGN_HANDOFF.md) — the designer-facing brief this UI was built against

## Run it

```bash
npm install
npm run dev
```

Opens on <http://localhost:1420>. The click-through works end to end: log in
(any credentials) → browse battles → join a room → ready up → start → debriefing.

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | Unit tests - protocol, stores, adapters (Node's runner, no extra deps) |
| `npm run test:e2e` | Drives every live code path against a fake server in a real browser |
| `npm run gen:protocol` | Regenerate `src/protocol/` from upstream C# |
| `npm run tauri:dev` | Run inside the desktop shell — **blocked, see below** |
| `npm run tauri:build` | Produce the NSIS installer — **blocked, see below** |

## Building the desktop app (Windows)

Requires the Rust MSVC toolchain **and** the Windows SDK. Getting this wrong
produces confusing errors, so two hard-won notes:

- **Never run `cargo` from Git Bash.** Its coreutils `link` shadows MSVC's
  `link.exe`, and you get `link: extra operand ...` — which looks like a Rust
  problem and is not. Use PowerShell or a Developer Command Prompt.
- **`error: linker 'link.exe' not found` means the Windows SDK is missing**, not
  that Rust is broken. The MSVC *compiler* can be installed without it. Check for
  `C:\Program Files (x86)\Windows Kits\10`; if it is absent, add the **Desktop
  development with C++** workload:

  ```
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  ```

`npm run tauri:dev` and `npm run tauri:build` go through
[`scripts/tauri.ps1`](scripts/tauri.ps1), which sets all of this up for you: it
puts `cargo` on PATH and imports the MSVC environment before handing off to the
Tauri CLI. You do **not** need a Developer Command Prompt, and it works in a
shell that was open before Rust was installed.

The script deliberately skips Visual Studio installs that cannot link. If a VS
install has `vcvars64.bat` but no `vcvarsall.bat` beside it, sourcing it fails
silently and leaves you with no `link.exe` — so the script requires the sibling
file and then verifies a linker actually appeared before accepting that install.

Verified working against: Rust 1.97.1 `x86_64-pc-windows-msvc`, MSVC 14.50.35717,
Windows SDK 10.0.26100.0.

Switching to the `windows-gnu` toolchain would sidestep the SDK entirely, but MSVC
is the tested path for Tauri's NSIS bundling and WebView2. Not worth it.

## Status

**Front end: built and verified.** All eight P0/P1 screens from the design kit are
implemented, rendering, and driven by fake data shaped like the real protocol payloads.

| Screen | File | State |
|---|---|---|
| Login | `src/screens/LoginScreen.jsx` | done |
| App shell | `src/screens/AppShell.jsx` | done |
| Battle list | `src/screens/BattleListScreen.jsx` | done |
| Battle room | `src/screens/BattleRoomScreen.jsx` | done |
| Chat | `src/screens/ChatScreen.jsx` | done |
| Matchmaker + ready-check | `src/screens/QueueScreen.jsx` | done |
| Debriefing | `src/screens/DebriefingScreen.jsx` | done |
| Friends / profile | `src/screens/FriendsScreen.jsx` | done |

Not built: settings (screen 9), downloads (10), Planet Wars (11) — deferred per the
handoff.

**Protocol layer: built and tested.**

| Piece | File | State |
|---|---|---|
| Generated types | `src/protocol/{enums,types,registry}.ts` | 76 commands, 7 DTOs, 8 enums, pinned to `48f6f09b` |
| Wire encode/decode + merge rule | `src/protocol/wire.ts` | tested |
| Relay bridge | `src/net/connection.ts` | live - logs in against `zero-k.info:8200` |
| Session + login handshake | `src/net/session.ts` | live |
| Normalized store | `src/store/lobby.ts` | live - drives the status bar and battle list |
| Battle room membership | `src/store/room.ts` | live - roster, teams, spectators, bots, mod options |
| Chat | `src/store/chat.ts` | live - channels, DMs, battle chat, unread and mention state |
| Matchmaker | `src/store/matchmaker.ts` | live - queues, joining, the ready check |
| Friends | `src/store/friends.ts` | live - list, add, remove, ignore, profiles |
| Match history | `src/store/history.ts` | live - debriefings, ratings, awards |
| Engine launch | `src/store/game.ts`, `src-tauri/src/launch.rs` | built; **not yet run against a real engine** |
| Install detection | `src-tauri/src/install.rs` | built; **not yet run against a real install** |
| Rust TCP relay | `src-tauri/src/relay.rs` | builds clean |

`npm test` runs 59 TypeScript tests; `cargo test` in `src-tauri/` runs 13 Rust tests.

## Testing the live paths

Most of the client only runs inside Tauri, which makes the interesting half
invisible to a browser and to unit tests. `npm run test:e2e` closes that gap: it
replaces `window.__TAURI_INTERNALS__` with [a fake
server](tools/e2e/fake-server.js) and drives the real UI through login, joining,
hosting, a passworded join, chat, the matchmaker ready check, friends, launching
an engine and a debriefing — 39 assertions against the same code the desktop
build runs.

```bash
npm run dev          # in another shell
npm run test:e2e
```

It drives a browser you already have rather than downloading one — the app ships
against WebView2, so any machine that can build it has Edge. Override with
`CHROMIUM_PATH=/path/to/chrome`.

The fake server is not a mock of our own code: it speaks the wire protocol, so
the assertions are about what we *send* (`OpenBattle` carries the engine from
`Welcome`; a locked battle sends its password with the join) rather than about
which function was called.

**The desktop app builds and packages.** `npm run tauri:build` produces:

```
src-tauri/target/release/bundle/nsis/Shiro_0.1.0_x64-setup.exe   1.6 MB
src-tauri/target/release/shiro.exe                               6.0 MB
```

Per-user NSIS install, no admin prompt. For contrast, an equivalent Electron
build would be roughly 150 MB.

Login against the live server is **verified working** out-of-band: account `Qrow`,
`ResultCode: 0`, session token issued. The auth format is confirmed as base64 of the
raw MD5 digest bytes.

Every screen reads from the live store inside Tauri, and from `src/data.js` in a
plain browser tab, so the click-through still works with no server.

## Layout

```
src/
  ds/shiro.js       Vendored Shiro design system (24 components). DO NOT HAND-EDIT.
  styles/           Design tokens (colour, type, spacing, borders, motion)
  screens/          The eight lobby screens
  data.js           Fake protocol-shaped data — replaced by the real store
  protocol/         (empty) generated protocol types will land here
  store/            (empty) normalized lobby state will land here
vendor/
  _ds_bundle.js     Raw export from Claude Design; src/ds/shiro.js is extracted from it
```

## Design system

Sourced from the **Shiro Design System** project on claude.ai/design
(`0f4b7d9c-821d-4805-bb51-6a6315784d06`). `src/ds/shiro.js` is extracted from that
project's bundle and must not be hand-edited — re-export and re-extract instead.
Tokens under `src/styles/tokens/` mirror the project's `tokens/*.css` one-to-one.

## Next

1. ~~Generate `src/protocol/` from upstream `Messages.cs`; pin the source SHA.~~ done
2. ~~Merge-not-replace store semantics, unit-tested.~~ done
3. ~~Tauri shell + Rust TCP relay.~~ done — builds and packages
4. ~~Run the app and log in.~~ done — verified against `zero-k.info:8200`.
5. ~~Battle room from the live store.~~ done — join, roster, teams, spectators,
   bots, mod options, room chat, team/spectate changes.
6. ~~`RequestConnectSpring` → write `script.txt` → spawn the engine.~~ built —
   see below. **Needs one run on a machine with Zero-K installed.**
7. ~~Swap the remaining demo screens for the live store.~~ done — chat,
   matchmaker, friends and debriefing all read live.
8. ~~Passworded battles.~~ done — a locked battle prompts before joining.
9. ~~Hosting.~~ done — `OpenBattle` with title, map, size and password.
10. Not built: settings, downloads and Planet Wars (screens 9-11, deferred per
    the handoff), parties, and kicking from a room you host.

## Launching a game

Implemented per ARCHITECTURE.md section 6, and **this is the part of the client
that has never touched real hardware.** Everything up to the process spawn is
unit-tested; the spawn itself has not run against a Zero-K install.

1. `src-tauri/src/install.rs` finds the Zero-K data directory — the standalone
   installer's location, the home directory, and every Steam library listed in
   `libraryfolders.vdf` (people move games to a second drive constantly).
2. `src-tauri/src/launch.rs` writes the eight-line connect script to the temp
   directory — deliberately *not* into the install, which under
   `Program Files` is not writable by a per-user process — and spawns the engine
   with `SPRING_DATADIR`/`SPRING_WRITEDIR` pointing at the install. The data dir
   goes through the environment rather than a flag because engine versions
   disagree about the spelling of the write-dir option and an unknown flag
   aborts startup.
3. The launch is driven by the *arrival* of `ConnectSpring`, not by the button
   that asks for it, so a matchmaker game starts correctly with nothing pressed.

What to check on first run: that `engine/win64/<version>/spring.exe` is where we
expect it, and that the engine finds the game and map rather than writing a fresh
data dir under Documents. Both failure modes surface as a message in the room's
SYNC panel or the engine's own error dialog.

A local `ZkLobbyServer` is no longer a prerequisite — see ARCHITECTURE.md section 8
for the revised guidance on developing against live.

## Vendor patches to `src/ds/shiro.js`

That file is generated from the Claude Design bundle and normally must not be
hand-edited — but two changes are applied on top. **Re-apply them after any
re-sync**, and report them upstream so the design project can fix them at source:

1. **Icon rendering.** lucide's `createIcons()` *replaces* each `<i data-lucide>`
   placeholder with an `<svg>`. React still holds a reference to the `<i>`, so the
   next unmount throws `NotFoundError: Failed to execute 'removeChild'` and React
   tears down the entire tree — a blank window. The shim renders the svg *inside*
   the placeholder instead. Never reintroduce a document-wide `createIcons()` call.
2. **Map URLs.** `MapImage` assumed map names are URL-safe. They are not — see
   ARCHITECTURE.md section 8. Spaces are normalized to underscores for the URL only.

Both are bugs in the design kit, not in the port. They were invisible in the static
prototype because nothing ever unmounted and the demo map names all used underscores.

## Known issues

- **Elo renders twice per player in the battle room.** `PlayerRow` spreads `user`
  into `UserChip` (which renders Elo) and `TeamColumn` also passes Elo via `right`.
  Present in the design kit as authored; left as-is rather than silently diverging.
  Designer decides the fix.
- **Bundle is 837 kB** because `lucide` is imported whole. Switch to per-icon imports
  before shipping.
- **Fonts load from Google Fonts.** Must be self-hosted before packaging — the app
  has to render offline and the Tauri CSP will block the request.
- **React pinned to 18.3.1** to match the version the design kit was authored against,
  not the 19 named in ARCHITECTURE.md. Revisit once the UI is stable.
