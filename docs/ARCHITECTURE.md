# NewLobby — Infrastructure & Connection Architecture

Status: decided, pending build. Every protocol claim below was verified against
ZkLobbyServer source and/or a live connection to `zero-k.info:8200` on 2026-08-18.

---

## 1. Decision summary

| Concern | Decision |
|---|---|
| Shell | **Tauri v2** (Rust core + system webview) |
| UI | **React 19 + TypeScript + Vite** |
| Styling | **Tailwind + CSS custom properties** for theming |
| State | **Zustand** (normalized stores, one per domain) |
| Transport | Raw TCP from Rust; UI never touches the socket |
| Protocol types | **Code-generated** from upstream `Messages.cs` |
| Content/engine | **Reuse the existing Zero-K install** for v1; `pr-downloader` later |
| Dev target | **Local ZkLobbyServer**, not the live server |

### Why Tauri and not Electron

The deciding constraint is that **the lobby server speaks raw TCP only**. There is no
WebSocket listener — `Shared/PlasmaShared/TcpTransport.cs` is the sole transport
implementation and `ZkLobbyServer/TcpTransportServerListener.cs` the sole listener. A
browser-based client is therefore impossible without operating a relay, which is a
server we would have to run, secure and pay for. So the shell must be native.

Given native is mandatory, Tauri wins on the things that matter for a game launcher:

- Raw TCP is one `tokio::net::TcpStream`; process spawn and sidecar binaries are
  first-class.
- ~10 MB bundle vs Electron's ~150 MB. This app sits in the tray and auto-updates.
- Lower idle memory, which matters for something running alongside an RTS.

**The one real risk:** Tauri uses the OS webview, so Linux gets WebKitGTK rather than
Chromium. Design-forward CSS (`backdrop-filter`, container queries, some grid
behaviour) degrades there. Zero-K has a meaningful Linux population. *Mitigation:
stand up a Linux VM in week 1 and test the design system on it before the designer
commits to a direction.* If WebKitGTK proves fatal, switching to Electron is a
shell-level change — all UI and protocol code ports unchanged. Keep the platform
boundary clean so this stays true.

---

## 2. The wire protocol (verified)

Dead simple, and this is the good news.

```
<CommandName><SPACE><json>\n
```

- UTF-8, no BOM (`TcpTransport.cs:24`).
- Newline-delimited; the server reads with `StreamReader.ReadLineAsync()`.
- Split on the **first** space only, max 2 parts (`CommandJsonSerializer.cs:36`).
- `CommandName` is literally the C# class name.
- Same format in both directions.

Verified live — this is a complete client that reads the handshake:

```python
import socket, json
s = socket.create_connection(("zero-k.info", 8200), timeout=12)
f = s.makefile("r", encoding="utf-8", newline="\n")
cmd, _, payload = f.readline().rstrip("\n").partition(" ")
print(cmd, json.loads(payload))
# -> Welcome {'Engine': '2025.06.21', 'Game': 'Zero-K v1.14.8.0', 'UserCount': 100, ...}
```

### Three serialization details that will bite us

These come from the server's `JsonSerializerSettings` and are easy to get wrong:

1. **`NullValueHandling.Ignore`.** Unchanged fields are *omitted*, not sent as null.
   This is why `BattleHeader` is all `int?` / `bool?`. `BattleUpdate` and
   `ChangeUserStatus` are **partial patches**. We must deep-merge into existing
   state, never replace. *This is the single most likely source of subtle bugs in
   the whole client* — a naive full-object assign will blank fields.
2. **Enums are numbers.** `UseEnumString` is disabled. `Mode: 6`, not `"Teams"`.
   The generator must emit numeric enums with the right members.
3. **Dates are ISO-8601 strings** (Newtonsoft default), nullable, and UTC. `AwaySince`,
   `InGameSince`, `RunningSince`, `JoinTime` all follow this.

### Surface size

84 type definitions across three files, ~1,150 lines total; roughly 65 are actual
commands and the rest nested DTOs.

- `Shared/LobbyClient/Protocol/Messages.cs` — 986 lines, core protocol
- `Shared/LobbyClient/Protocol/MatchMakerMessages.cs` — 123 lines
- `Shared/LobbyClient/Protocol/PartyMessages.cs` — 44 lines

---

## 3. Type generation

We do **not** hand-write 84 interfaces. We generate them.

A ~200-line script parses the three `.cs` files and emits:

- `src/protocol/types.ts` — one interface per message, nullable fields optional
- `src/protocol/enums.ts` — numeric enums
- `src/protocol/registry.ts` — a discriminated union keyed by command name, so
  `handleMessage(msg)` is exhaustively type-checked

Run it as `npm run gen:protocol`, commit the output, and pin the upstream commit SHA
in a header comment. When ZK changes the protocol, re-run and the TypeScript compiler
tells us exactly what broke. This is the main defence against the rot that killed
every previous alternative client.

C# to TS mapping: `string` to `string`, `int`/`float`/`double` to `number`, `bool` to
`boolean`, `DateTime` to `string`, `T?` to `field?: T`, `List<T>` to `T[]`,
`Dictionary<K,V>` to `Record<K,V>`.

### The in-game settings menu

The same argument applies to Zero-K's settings. The official client's settings
window - two tabs, six presets, 39 controls and the several hundred key/value
pairs behind them - is declared in one Lua table in Chobby
(`LuaMenu/configs/gameConfig/zk/settingsMenu.lua`). `npm run gen:settings` parses
it into `src/protocol/settings.ts`, pinned the same way.

Three things do not survive a generator, and each is handled explicitly rather
than dropped:

- **Fourteen settings upstream applies with a Lua function**, not a table. Those
  are ported by hand in `src/net/gameSettings.ts`, and a test fails if upstream
  grows one that has no port. A settings screen whose switches silently do
  nothing is worse than one that does not offer them.
- **Two of the three files it writes.** Only `springsettings.cfg` is patched key
  by key. `lups.cfg` and `cmdcolors.txt` are regenerated whole by substituting
  placeholders into a template that ships inside the Chobby archive; the seven
  small templates are vendored in `src-tauri/src/templates/` at the same pin,
  with a test asserting every placeholder we substitute still exists.
- **Four entries that configure Chobby, not the game** - two display-mode
  controls, a driver label and lobby text-to-speech. They are emitted as
  unsupported with a reason, and the screen skips them. Resolution stays
  reachable through the raw keys under Advanced.

Two rules make the screen safe to open on someone's tuned install:

- It opens showing what the files actually say, by running the menu backwards
  and finding the option each setting's keys agree with. A real file is missing
  keys all the time, so an option matches on the keys that are present and the
  best agreement wins. Whatever matches nothing is labelled Custom.
- **Apply writes the diff, not the picture.** A Custom setting - or any of the
  ~110 keys this menu does not model - is never rewritten, because rewriting the
  whole picture would push a default over a value the player chose.

---

## 4. Process architecture

```
+------------- Tauri (Rust) --------------+   +---- Webview (TS) -----+
| TCP connect / reconnect w/ backoff      |   | codegen'd types       |
| line framing + write queue              |<->| message handlers      |
| TCP keepalive (socket option)           |   | normalized stores     |
| engine process spawn + supervision      |   | React UI              |
| filesystem, script.txt, pr-downloader   |   |                       |
+-----------------------------------------+   +-----------------------+
     emits `zks://line` (string)   <----->   invokes `send_line(String)`
```

**Rust is a thin, dumb relay.** It owns the socket lifecycle and anything touching the
OS. It does *not* parse messages or hold lobby state.

All protocol logic and state live in TypeScript. Rationale: one language for all
business logic, trivially unit-testable without a running app, far faster iteration,
and the message volume is nowhere near enough for IPC to matter (~10–50 msg/s at
peak, against an IPC path good for orders of magnitude more). Revisit only if
profiling says otherwise — it will not.

Consequence to handle: on webview reload (including dev hot-reload) TS state is lost
while the Rust socket is still alive. Simplest correct behaviour is for the webview to
signal readiness on mount and Rust to tear down and re-establish the connection.
Re-login is fast and this keeps a single, well-tested startup path.

---

## 5. Connection lifecycle

1. **TCP connect** to `zero-k.info:8200`.
2. **Server sends `Welcome`** immediately, unprompted. Contains `Engine`, `Game`
   (the versions we should be running), `UserCount`, `Version`, `ChallengeToken`,
   `ServerPubKey`, `Blacklist`, `Factions`.
3. **Client sends `Login`.** Before login the server accepts only `Login` and
   `Register` (`ClientConnection.cs:62`).
4. **Server replies `LoginResponse`** with a `Code` enum (0 = Ok; 2 invalid name,
   3 invalid password, 4 banned, 9 server full, and so on).
5. **Server floods initial state.** Measured on a live login, 2026-08-18, with 43
   users online — roughly 90 messages inside 4 seconds:

   | Count | Command |
   |---|---|
   | 41 | `User` (one per online account) |
   | 20 | `Say` (channel backlog replayed on join) |
   | 16 | `BattleAdded` |
   | 2 | `JoinChannelResponse`, 2 × `ChannelUserAdded` |
   | 1 each | `FriendList`, `IgnoreList`, `MatchMakerSetup`, `MatchMakerStatus`, `PwStatus`, `NewsList`, `LadderList`, `ForumList`, `UserProfile` |

   Scale that by concurrency: a weekend peak of several hundred users means several
   hundred `User` messages. The UI must not render per-message — batch into an
   animation frame. Note `Say` arrives in the flood too, so chat scrollback must
   handle a backlog burst before any live message appears.
6. **Steady state** — incremental updates.

> **Do not send an application-level keepalive.** `Ping` is not a registered
> command: `CommandJsonSerializer.DeserializeLine` throws
> `Invalid json type ... : Ping`, which lands in the server's logs against the
> user's account and consumes the connection's throttle budget. Chobby has an
> `Interface:Ping`, but it is fenced behind a `REVERSE_COMPAT` flag that is off —
> easy to copy without the fence. The server has no idle timeout, so nothing
> needs sending; the relay sets a TCP keepalive socket option instead, which is
> the right layer for noticing a silently dead connection.

### Authentication

```json
Login {"Name":"user","PasswordHash":"<base64(md5(password))>","UserID":0,
       "InstallID":"...","ClientType":1,"LobbyVersion":"NewLobby 0.1.0"}
```

`PasswordHash` is **base64 of the raw MD5 digest bytes** — not hex. Verified against
the live server on 2026-08-18: raw-digest base64 returns `ResultCode: 0`. (Yes, MD5.
It is what the server expects; not our call to change.)

**Account names are case-sensitive in practice.** `qrow` returns `InvalidName` (2)
where `Qrow` succeeds, despite the case-insensitive fallback in `LoginChecker` and
SQL Server's usual case-insensitive collation. Do not assume a case-folded name will
match — pass exactly what the user typed, and treat code 2 as "check your spelling
and capitalisation" in the UI copy.

**The name is checked before the password**, so `InvalidName` (2) and
`InvalidPassword` (3) are genuinely different failures and deserve different copy.
Be sparing with retries: `LoginChecker.LogIpFailure()` fires on a bad name and enough
failures earn `BannedTooManyConnectionAttempts` (6). Never auto-retry a rejected login.

`LoginResponse` also returns a **`SessionToken`** (a GUID). Design the relay's
reconnect path around it from the start rather than re-sending credentials.

The RSA challenge/`ClientPubKey` path is **optional**. Reading `LoginChecker.cs:110-120`:
the pubkey check only runs on the passwordless branch. Name + password works today
and we can ignore RSA entirely for v1.

Set `LobbyVersion` to something clearly identifying this client. ZK admins use it for
support, and it is the polite thing to do when a new client appears on their server.

---

## 6. Launching a game

Verified end to end. This is much smaller than it looks, because **we never host** —
the server runs the game and just tells us where to connect.

1. Client sends `RequestConnectSpring {BattleID, Password}`.
2. Server replies `ConnectSpring {Engine, Game, Ip, Port, Map, ScriptPassword, Mode,
   Title, IsSpectator}`.
3. Ensure engine, game and map are present locally (section 7).
4. Write `script.txt` — the *entire* connect script, per `ScriptGenerator.cs:22-34`:

```
[GAME]
{
HostIP=<Ip>;
HostPort=<Port>;
IsHost=0;
MyPlayerName=<our name>;
MyPasswd=<ScriptPassword>;
}
```

5. Spawn the engine with that script as its argument, working directory set to the
   engine folder.
6. Supervise the process. On exit, surface the lobby again; the server will send
   `BattleDebriefing` with results, Elo deltas and awards.

That is it. Eight lines of script and a process spawn.

Steps 1-5 are also available without step 6: `zks_launch_preview` resolves the
install, the engine binary, the working directory, the environment and the script
and returns them without spawning anything. The settings screen exposes it as
"Check launch setup". This exists because the launch is the only path in the
client that cannot be exercised without a Zero-K install and a live match, and a
first run that fails should say which of those five steps it failed at.

---

## 7. Content acquisition — deliberately deferred

This is where the schedule usually dies, so we cut it.

**v1 requires an existing Zero-K installation.** We detect it (Steam library folders,
`%LOCALAPPDATA%\Programs\Zero-K`, `~/.config/spring`) and reuse its engine, games and
maps. If we cannot find one, we say so plainly and link the official installer. This
removes engine downloading, rapid protocol handling and integrity checking from the
critical path entirely, and it is *not* a meaningful limitation — everyone running a
Zero-K lobby already has Zero-K.

**v2 adds downloads via `pr-downloader`**, which ships inside every engine
distribution. We shell out to it and parse progress:

```
pr-downloader --filesystem-writepath <dir> --download-game "zk:stable"
pr-downloader --filesystem-writepath <dir> --download-map "<MapName>"
```

Note that Chobby does *not* do this — it uses `PlasmaDownloader`, a bespoke C#
reimplementation of rapid. Shelling out to the engine's own downloader is a fraction
of the work and stays correct as rapid evolves.

### Correction: pr-downloader is not sufficient for mod support

The paragraph above originally went on to say we should not copy what the official
client does. That was wrong, and the reason matters.

**pr-downloader only knows rapid and springfiles.** It cannot fetch Zero-K community
content. Verified against springfiles: `Supreme-K 3.42`, `ZeroWars v2.1.9` and
`Arena Mod v1.0.10` all return an empty result, while a control query for
`Comet Catcher Redux` returns a real record — so this is genuine absence, not a
malformed query. The same three are also missing from all 50 cached rapid repos.

Yet two of them are installed locally, because the official client put them there. It
resolves community content through `zero-k.info/ContentService`
(`TorrentDownloader.cs` → `DownloadFileRequest{InternalName}` → `links[]`), a source
pr-downloader has never heard of.

So the split is:

| Content | pr-downloader | Notes |
|---|---|---|
| `zk:stable`, the default game | ✅ rapid | |
| Common maps | ✅ springfiles | coverage looks frozen around 2011–2017 |
| Mods, custom game modes, their maps | ❌ | needs ContentService |

pr-downloader still earns its place — it fixes the hung-engine problem for ordinary
battles, which is the common case. It just does not deliver the mod support that
motivated the work. **See [DOWNLOADS.md](DOWNLOADS.md)** for the full analysis, the
verified CLI (note: progress output is carriage-return terminated, so a line reader
sits silent for an entire download), and a spike to confirm the ContentService route
before committing to a mod-support date.

---

## 8. Endpoints and constants

| Purpose | Value | Source |
|---|---|---|
| Lobby server (live) | `zero-k.info:8200` TCP | `GlobalConst.cs:72-73` |
| Lobby server (test) | `test.zero-k.info:8202` | `GlobalConst.cs:59-60` |
| Website / API base | `https://zero-k.info` | `GlobalConst.cs:68` |
| Map thumbnail | `https://zero-k.info/Resources/<MapName>.thumbnail.jpg` | verified 200, ~13 KB |
| Map minimap | `https://zero-k.info/Resources/<MapName>.minimap.jpg` | verified 200, ~140 KB |
| Rapid tag, game | `zk:stable` | `GlobalConst.cs:101` |
| Rapid tag, menu | `zkmenu:stable` | `GlobalConst.cs:102` |
| Springfiles mirror | `https://springfiles.springrts.com/` | `GlobalConst.cs:99` |
| Steam AppID | `334920` | `GlobalConst.cs:108` |

**Map asset names are not the names the server sends.** ZkLobbyServer sends
`BattleHeader.Map` with spaces — `Adamantine Mountain 2` — but zero-k.info stores
the assets with underscores — `Adamantine_Mountain_2.thumbnail.jpg`. Percent-encoding
the space is *not* enough; `%20` still 404s. Replace spaces with underscores before
building any Resources or `/Maps/Detail` URL.

Measured on the live server, 2026-08-18: of 16 distinct maps across all open
battles, **13 contained spaces and every one of them 404'd**. Only `Grts_Messa_008`,
`TartarusV7` and `TheBeachBeta` resolved. This is easy to miss in testing because
the maps that happen to work are the ones already written with underscores.

Keep the spaces for display; normalize only the URL.

**Development target.** The documented test server at `test.zero-k.info:8202` is
currently unreachable (connection timeout, checked 2026-08-18). Do not develop against
live — a reconnect loop hammering a production game server is how a new client gets
IP-banned before it ships. `ZkLobbyServer` is open source and has an explicit `Local`
mode targeting `localhost:8200` (`GlobalConst.cs:47-48`). **Stand up a local instance
in week 1.** It needs SQL Server LocalDB; budget a day for setup.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Steam-only accounts cannot log in | **High** | Steam auth needs a ticket under ZK's AppID, unavailable to third-party binaries. Password login only; document that Steam users must set a password on zero-k.info. Accept the audience limit. |
| Protocol drift | **High** | Codegen + pinned upstream SHA + CI check that regeneration produces no diff. |
| Partial-update merge bugs | Medium | Merge semantics implemented once, in one place, with unit tests. Never patch state ad hoc. |
| WebKitGTK rendering on Linux | Medium | Test in week 1, before design locks. Electron is the escape hatch. |
| No usable test server | Medium | Run ZkLobbyServer locally. |
| Unsigned installer trips SmartScreen | Medium | Code signing has weeks of lead time and a regional eligibility gate. Start it early — see section 11. |
| Community reception | Low | Talk to ZK devs early. It is open source and a nicer client helps them, but arriving unannounced with a third-party client is worse than a heads-up. |

---

## 10. Build order

1. Local ZkLobbyServer running; Linux webview smoke test.
2. Protocol codegen; Rust relay; connect + login + `Welcome` parsed.
3. Stores: users, channels, battles — with merge semantics and tests.
4. Battle list + chat (proves read path against real data).
5. Battle room (largest single screen; proves write path).
6. `RequestConnectSpring` to script.txt to engine spawn to return-to-lobby.
7. Everything else.

Steps 1–6 are the MVP and the honest estimate remains 6–10 weeks full-time.

---

## 11. Windows packaging and distribution

Requirement: ship as a standard Windows installer. This is well-trodden for Tauri and
mostly config, with one exception that has real lead time (code signing — start it now).

### Installer format: NSIS, not MSI

Tauri v2 bundles both `.msi` (via WiX v3) and `-setup.exe` (via NSIS). We want **NSIS**:

- **Per-user install by default**, so no UAC prompt and no admin rights needed. For a
  game client this materially improves the install funnel.
- Installs to `%LOCALAPPDATA%\Programs\`, which we can write to freely at runtime —
  and we do write at runtime (`script.txt` on every game launch). A Program Files
  install would force us into a separate writable-data path.
- Works with the Tauri updater; MSI-based auto-update is worse.
- Cross-compilable from Linux/macOS, so CI is not pinned to Windows runners. (MSI
  can only be built on Windows.)

Config lives in `tauri.conf.json` under `bundle.windows.nsis`. Set
`installMode: "currentUser"`. Target **x64 only** — ARM64 Windows is not a meaningful
share of this audience.

### WebView2 runtime

Tauri renders through WebView2, which must be present on the machine. Options:

| Mode | Installer size impact | Needs internet at install |
|---|---|---|
| `downloadBootstrapper` (default) | 0 MB | Yes |
| `embedBootstrapper` | ~1.8 MB | Yes |
| `offlineInstaller` | ~127 MB | No |
| `fixedVersion` | ~180 MB | No |

**Use `downloadBootstrapper`.** This app is a multiplayer lobby — it is useless without
a network connection, so the offline case does not exist for us. Windows 11 ships
WebView2 preinstalled and Windows 10 has had it via Windows Update for years, so for
most users this is a no-op anyway.

### Code signing — the one item with lead time

An unsigned installer triggers the full-screen SmartScreen "Windows protected your PC"
warning. For a **third-party game client that asks for your account password**, that is
not a cosmetic issue — it is the difference between a client the community trusts and
one people warn each other about. Unsigned Rust binaries that open sockets and spawn
child processes also draw antivirus false positives.

Two viable routes:

1. **Azure Trusted Signing** (renamed *Azure Artifact Signing* in 2026) — ~$9.99/month
   Basic tier, up to 5,000 signatures. Cloud-based, so it integrates with CI cleanly
   and needs no hardware token. This is the right default for a project this size.
   **Caveat to check first:** individual-developer identity validation has been
   geographically limited (US/Canada), with EU/UK/Australia coverage repeatedly
   "coming soon". Verify eligibility for our region before planning around it.
2. **Traditional OV/EV certificate** — roughly $200–600/year. Since 2023 all code
   signing certificates require FIPS 140-2 Level 2 hardware storage, so signing in CI
   means a cloud HSM or a physical token plugged into a build machine. More friction,
   no geographic gate.

Either route involves identity validation that takes days to weeks. **Begin this in
week 1**, in parallel with development, so it is not the thing blocking release.

Note that reputation is separate from validity: an OV certificate still accumulates
SmartScreen reputation over download volume, so early users may see warnings regardless.
EV certificates get instant reputation.

### Auto-update

Use the Tauri updater plugin. It signs update artifacts with its own minisign keypair,
which is **separate from Authenticode signing** — we need both. Host the update manifest
and artifacts on GitHub Releases; no infrastructure of our own required.

