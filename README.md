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
| `npm test` | Protocol wire + merge-semantics tests (Node's runner, no extra deps) |
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
| Wire encode/decode + merge rule | `src/protocol/wire.ts` | 8 passing tests |
| Relay bridge | `src/net/connection.ts` | compiles; not yet exercised in-app |
| Session + login handshake | `src/net/session.ts` | compiles; not yet exercised in-app |
| Normalized store | `src/store/lobby.ts` | compiles; not yet exercised in-app |
| Rust TCP relay | `src-tauri/src/relay.rs` | builds clean, 1 unit test passing |

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

The screens still render from `src/data.js`. Nothing is wired to the store yet —
that is the next step once the shell builds.

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
4. **Run the app and log in.** The relay, session and login wiring all compile,
   but nothing has driven them through a real GUI yet. Run `npm run tauri:dev`
   (or install the NSIS package) and confirm a real account reaches
   `ResultCode: 0` and the battle list populates from the server.
5. Swap the rest of `src/data.js` for the live store, screen by screen. Login,
   status bar and battle list already read from it; chat, battle room, queue,
   friends and debriefing are still demo data.
6. `RequestConnectSpring` → write `script.txt` → spawn
   `<ZK>/engine/win64/<Engine>/spring.exe`. The install is already located and the
   version string the server sends matches the directory name exactly.

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
