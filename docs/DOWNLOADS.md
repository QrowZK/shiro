# Content acquisition — design and scope

Status: **scoped, not built.** This un-defers ARCHITECTURE.md section 7.

Everything marked *verified* below was checked on 2026-08-18 against the Zero-K
install at `C:\Program Files (x86)\Steam\steamapps\common\Zero-K` (engine
`2025.06.21`), against the shipped `pr-downloader.exe` itself, and against the
live springfiles/rapid endpoints. Everything marked **unverified** is exactly
that — do not build on it without checking first. A wrong flag makes the engine
abort at startup, and a wrong assumption about coverage makes the feature not
work for the one case it was built for.

---

## 0. The short version

Three things changed my mind while researching this.

1. **pr-downloader's CLI is real, small, and exactly what §7 guessed.** The flags
   in ARCHITECTURE §7 are correct. Shelling out remains the right call. §7 stands.

2. **But pr-downloader cannot fetch Zero-K community content.** It knows two
   sources: rapid (`repos.springrts.com`) and springfiles
   (`springfiles.springrts.com/json.php`). Zero-K's own custom mods and newer
   community maps are on *neither*. Verified: `Supreme-K 3.42`,
   `Arena Mod v1.0.10`, `RGSUAIFG_2.35.24` and the map `ZeroWars v2.1.9` all
   return `[]` from springfiles and appear in none of the 50 rapid repos. The
   official client gets them from a Zero-K-hosted service that pr-downloader has
   never heard of (§1.6).

   So the framing "a minimum slice unblocks joining a Supreme-K battle" is
   **probably wrong**. pr-downloader unblocks `zk:stable` and most maps. Supreme-K
   needs a second source. Read §1.6 before planning the sprint.

3. **The "is it already installed?" question is harder than it looks**, because
   archive *names* ("Arena Mod v1.0.10") are not file names (`arenamodv1010.sd7`).
   The cheapest correct answer is to not answer it: pr-downloader is idempotent
   and cheap when content is present. §2.2.

The recommended shape is a new `src-tauri/src/content.rs` — a sibling of
`launch.rs`, same conventions: a resolved plan struct, pure functions separated
from the spawn, progress emitted on a `zks://` event like `relay.rs` does.

---

## 1. pr-downloader: the verified interface

### 1.1 Where it is

Ships inside every engine directory. No separate install, no sidecar to bundle:

```
<ZK>\engine\win64\2025.06.21\pr-downloader.exe
```

Same directory as `spring.exe`, so `install::find_engine`'s path logic already
resolves the folder. Add a sibling `install::find_pr_downloader(root, version)`
using the same candidate list with a different file name (`pr-downloader.exe` on
Windows, `pr-downloader` elsewhere).

**Which engine's copy?** Any of them will do for pooling content — the pool
format is stable. Use the engine version from `ConnectSpring.Engine`, falling
back to the newest installed engine directory, so we never depend on an engine
we are about to tell the user is missing.

### 1.2 Flags — verbatim from `pr-downloader.exe --help` (verified)

```
pr-downloader tarball (windows64)
Options:
 --help
 --version
 --filesystem-writepath <value>    Set the directory with data, defaults to current dir
 --download-game <value>           Download games by name or rapid tag, eg. 'GG 1.2', 'gg:test', 'rapid://gg:test'
 --rapid-download <value>          Alias to --download-game
 --download-map <value>            Download maps by name
 --download-engine <value>         Download engines by version
 --rapid-validate                  Validates correctness of files in rapid pool
 --delete                          Delete invalid files when executing --rapid-validate
 --validate-sdp <value>            Validate correctness of files in Sdp archive, takes full path to the Sdp file
 --dump-sdp <value>                Dump contents of Sdp file, takes full path to the Sdp file
 --disable-logging                 Disables logging
 --disable-fetch-depends           Disables downloading of dependend archives
```

Plus, verbatim:

> All `--download-*` flags can be specified multiple times which will download
> multiple assets with a single invocation.

That last line is load-bearing for the design: **a battle's game and map are one
invocation, not two.** Verified by running it with `--download-game X
--download-map Y` in a single call.

Environment variables, also from `--help` (verified), defaults in brackets:

| Variable | Default | Use to us |
|---|---|---|
| `PRD_RAPID_USE_STREAMER` | `true` | leave alone |
| `PRD_RAPID_REPO_MASTER` | `https://repos.springrts.com/repos.gz` | leave alone |
| `PRD_MAX_HTTP_REQS_PER_SEC` | `0` (unlimited) | leave alone |
| `PRD_HTTP_SEARCH_URL` | `https://springfiles.springrts.com/json.php` | a hook for a ZK mirror if one ever appears |
| `PRD_DISABLE_CERT_CHECK` | `false` | never set |

Three more exist in the binary but not in `--help` (found by string-scanning the
exe, so *verified present*, semantics inferred): `PRD_ENABLE_TRACING`,
`PRD_SSL_CERT_FILE`, `PRD_SSL_CERT_DIR`.

### 1.3 The exact invocation we should build

```
pr-downloader.exe
  --filesystem-writepath <ZK install root>
  --download-game "zk:stable"          # zero or more
  --download-map  "Adamantine Mountain 2"   # zero or more
```

**writepath must be the Zero-K install root**, not a private directory.
`launch.rs` sets `SPRING_DATADIR`/`SPRING_WRITEDIR` to the install root and
nothing else, so content downloaded anywhere else is invisible to the engine.

Verified: the install root and `packages/` are both writable by this per-user
process, despite living under `Program Files (x86)` — Steam relaxes the ACLs on
`steamapps`. **Do not assume this holds everywhere.** A `Program Files` install
that came from the standalone installer running elevated will not be writable,
and the failure mode is an unhelpful pr-downloader error. §7 covers what to say.

*(Escape hatch, **unverified**: Spring's `SPRING_DATADIR` is documented as
accepting several paths separated by `;` on Windows. If that holds, an
unwritable install could be paired with a private writepath appended to the data
dir. Worth a 30-minute spike before it is ever needed; out of scope for MVP.)*

Do **not** pass `--disable-logging`. Verified: it silences *all* stdout including
`[Progress]`, and does not silence the stderr noise, so it costs us everything
and buys nothing.

Do **not** pass `--disable-fetch-depends`. Verified from `ArchiveCache20.lua`
that custom games declare `depend = { "rapid://zk:stable" }` — dependency
fetching is the reason a Supreme-K download also brings the base game.

### 1.4 Output — parseable line by line, with one trap

No pty needed. Both streams are plain pipes.

**stdout** carries `[Info]`, `[Warn]`, `[Debug]` and `[Progress]`.
**stderr** carries `[Error]` *and* libcurl's full verbose trace.

The log format is `[Level] file:line:func():message\n` — verified from real
output:

```
[Info] /build/src/tools/pr-downloader/src/FileSystem/FileSystem.cpp:203:setWritePath():Using filesystem-writepath: C:/...
[Info] /build/src/tools/pr-downloader/src/pr-downloader.cpp:191:DownloadSetConfig():Free disk space: 421779 MB
[Info] /build/src/tools/pr-downloader/src/Downloader/Rapid/RapidDownloader.cpp:254:ParseFD():Found 50 repos in ...
```

The `/build/src/tools/pr-downloader/...` prefix confirms this binary is Recoil's
vendored copy of the [beyond-all-reason/pr-downloader](https://github.com/beyond-all-reason/pr-downloader)
tree, which is what I read the source against.

**Progress is carriage-return terminated, not newline terminated.** The format
string, extracted verbatim from the shipped `pr-downloader.exe`:

```
[Progress] %3.0f%% [%.30s] %lli/%lli \r
```

Real captured output — note this is all **one line** as far as a `\n` reader is
concerned:

```
[Progress]   2% [=                             ] 1/50 [Progress]   4% [==      ...
```

So: **split the stdout byte stream on both `\r` and `\n`.** A `BufReader::lines()`
loop will sit silent for the whole download and then hand you one enormous line.
This is the single most likely implementation bug in the feature.

From `Logger.cpp` upstream: progress is throttled to one write per 150 ms and
skipped entirely when the integer percentage has not changed. So the emit rate is
bounded — no need to debounce on our side beyond coalescing into an animation
frame in the UI.

**What the two counters mean is only partly verified.** In my runs they counted
*files* (`1/1` for the repo master, then `1/50 … 50/50` for the per-repo
`versions.gz` files). For a real archive fetch they are more likely bytes.
Treat them as opaque: show `percent` from the `%` field, and render
`done/total` only if you can sanity-check the magnitude (a `total` over ~10^6 is
bytes; under ~10^4 is files). Verify on the first real download.

**stderr is noisy and must still be drained.** libcurl verbose is on
unconditionally; a real run emits the whole TLS handshake and request/response
headers:

```
*   Trying 46.225.144.165:443...
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384
> GET /json.php?category=game&springname=ShiroDefinitelyNotAGame%200.0.0 HTTP/1.1
< HTTP/1.1 200 OK
[Error] /build/.../main.cpp:187:main():Error occurred while downloading: 1
```

If you do not read stderr the pipe fills and the child blocks. Read it, keep the
last N KB in a ring buffer for the error report, forward only `[Error]` lines to
the UI, and drop the rest. (The trace also leaks the exact URLs being requested
into anything we log — keep it out of any telemetry.)

### 1.5 Exit codes

From upstream `main.cpp` and `pr-downloader.cpp` (read at
`beyond-all-reason/pr-downloader@master`), cross-checked against observed
behaviour:

| Code | Meaning |
|---|---|
| 0 | everything downloaded (also: `--help`, `--version`, the `*-sdp`/validate paths) |
| 1 | bad arguments, argument parse exception, search failed, item not found, or nothing queued |
| 2 | one or more downloads did not reach `STATE_FINISHED` |
| 5 | insufficient free disk space (`MBsFree < MBsNeeded`) |
| 6 | dependency resolution failed (`fetchDepends && !addDepends(dls)`) |

`main()` returns `DownloadStart()`'s value verbatim, so 2/5/6 reach us.

**Caveat, verified the hard way.** Upstream `main.cpp` logs
`Failed to find '%s' for download` before returning 1 when an item is not found.
Asking the shipped binary for a game that does not exist gave exit **1** with
only `Error occurred while downloading: 1` — the "Failed to find" line never
appeared, even though the format string is present in the binary. Either the
vendored copy is older than master, or the search marks the item found and the
queue ends up empty. Either way: **do not discriminate "not found" from "failed"
by exit code or by that log line.** Distinguish them by checking, after a
non-zero exit, whether the content is now present. §2.2.

### 1.6 What pr-downloader can and cannot fetch — the finding that matters

pr-downloader resolves a name through exactly two sources.

**Rapid.** `https://repos.springrts.com/repos.gz` lists 50 repos; each has a
`versions.gz` of `tag,md5,depends,name` rows. The `zk` repo is there. Verified
locally:

```
zk:stable,06860629e67e11ef60760893bbfb60d5,,Zero-K v1.14.8.0
zk:test,b02c564322ea9c62d41465a0823c126e,,Zero-K test-20735-a50c653
```

So both the rapid tag `zk:stable` **and** the human game name
`Zero-K v1.14.8.0` — which is exactly what `ConnectSpring.Game` and
`BattleHeader.Game` contain for a normal battle — resolve through rapid. Good.

**Springfiles.** `GET /json.php?category=<map|game>&springname=<name>` (verified
from the captured stderr trace). Exact-name matching. Verified working:

```
GET .../json.php?category=map&springname=Adamantine%20Mountain%202
[{"name":"Adamantine Mountain 2","filename":"adamantine_mountain_2.sd7",
  "md5":"9045b8...","size":11584315,
  "mirrors":["https://springfiles.springrts.com/files/maps/adamantine_mountain_2.sd7"]}]
```

Note it takes the *server's* spelling with spaces — the underscore normalisation
that ARCHITECTURE §8 requires for thumbnail URLs is **not** wanted here. Pass
`BattleHeader.Map` through unchanged.

**Now the gap.** Every one of these returns `[]` from springfiles, under
`category=map`, `category=game`, no category, and by `filename=`:

| Name | Where it comes from | springfiles | in any rapid repo |
|---|---|---|---|
| `Supreme-K 3.42` | `GetCustomGameMode{SupremeK}.game` | miss | miss |
| `Arena Mod v1.0.10` | live battle | miss | miss |
| `RGSUAIFG_2.35.24` | live battle | miss | miss |
| `ZeroWars v2.1.9` | `GetCustomGameMode{zeroWars}.map` | miss | miss |
| `Iced Coffee 1.1` | ZK map rotation | miss | miss |

(Rapid checked by decompressing all 50 cached `versions.gz` — 30,933 rows — and
grepping. The cached indices are what pr-downloader itself just fetched, so this
is the same data it searches.)

Meanwhile all five are ordinary Zero-K content, and two of them are installed on
this machine as plain files that the official client put there:

```
<ZK>\games\supreme2.91.sdz      -> archive name "Supreme-K 2.91", depend rapid://zk:stable
<ZK>\games\arenamodv1010.sd7    -> archive name "Arena Mod v1.0.10", depend rapid://zk:stable
```

**Where the official client gets them.** `Shared/PlasmaDownloader/PlasmaDownloader.cs`
falls back to `TorrentDownloader` for anything rapid does not resolve, and
`Torrents/TorrentDownloader.cs` calls a Zero-K-hosted service:

```csharp
e = plasmaService.Query(new DownloadFileRequest() { InternalName = name });
... e.links.OrderByDescending(x => x.Contains("zero-k.info")).FirstOrDefault()
```

`plasmaService` is `GlobalConst.GetContentService()` →
`BaseSiteUrl + "/ContentService"`. `https://zero-k.info/ContentService.svc`
answers 200 (verified). Implementation is `Zero-K.info/AppCode/ContentServiceImplementation.cs`,
delegating to `PlasmaServer.DownloadFile(InternalName)`.

Springfiles coverage is *broad but frozen*: `Grts_Messa_008`, `TartarusV7`,
`TheBeachBeta`, `Comet Catcher Redux` all resolve, with timestamps of 2011;
`Onyx Cauldron 1.8` is 2017; nothing newer appeared in my sample. Assume
springfiles covers the older ZK map corpus and nothing added in the last several
years.

**Consequences for planning.**

- `zk:stable` and the default `Zero-K vX.Y.Z` game: pr-downloader handles it.
- Most maps in circulation: pr-downloader handles it.
- Recent community maps and *all* ZK custom mods: pr-downloader does not.
- Therefore **pr-downloader alone does not deliver mod support.** It delivers the
  base game and the common map case, which is still most of the "engine hangs on
  a black screen" problem, but it is not the mod story.

**This spike has since been done — see `docs/DOWNLOADS-ZK-CONTENT.md`.** The
answer: SOAP only, over plain HTTP only (HTTPS 404s on POST), and it resolves
both a map and a custom mod that nothing else can reach. The paragraph below is
the original question, kept because the reasoning still holds.

**Open work (unverified, needs a spike).** Is `ContentService` reachable as
anything other than WCF/SOAP? A plain JSON or REST route on zero-k.info would
turn the fallback into thirty lines of Rust plus a file download. If it is only
SOAP, hand-rolling one `DownloadFileRequest` envelope and scraping `links[]` out
of the response is still small — WCF `basicHttpBinding` is plain HTTP POST with
an XML body. Budget half a day to find out, and do it **before** committing to a
mod-support date. Note also that whatever the answer, the *download* half is
trivial: `links[]` are ordinary HTTP URLs and the file drops into
`<ZK>\games\` or `<ZK>\maps\` by extension.

Ask the ZK developers. This is precisely the "talk to ZK devs early" risk in
ARCHITECTURE §9, and a five-minute answer from them beats a day of reverse
engineering.

### 1.7 What a run costs when there is nothing to do

Verified. A cold run against an empty writepath fetched `repos.gz` plus 50
`versions.gz` files — roughly 2–3 MB of metadata, about 2 seconds wall clock. A
second run reused them (there is ETag support in the tree, `Downloader/Http/ETag.cpp`)
and produced almost no output.

Against the real install, `<ZK>\rapid\` is already populated, so the steady-state
cost of "check and do nothing" is a couple of conditional GETs. That is what
makes §2.2's recommendation viable.

---

## 2. Where downloads sit in the launch flow

### 2.1 What we know, and when

| Signal | Fields | Arrives |
|---|---|---|
| `BattleHeader` (`BattleAdded`/`BattleUpdate`) | `Engine`, `Game`, `Map` | when the battle list loads, and on every change |
| `CustomGameModeResponse.GameModeJson` | `{ map?, game?, rapidTag?, options? }` | on `GetCustomGameMode{ShortName}` |
| `ConnectSpring` | `Engine`, `Game`, `Map`, `Ip`, `Port`, … | seconds before the engine must start |

The crucial point: **`BattleHeader` already tells us the game and map the moment
the player joins a room** — often minutes before `ConnectSpring`. `ConnectSpring`
is far too late to start a 300 MB download; by then the host is counting down.

So there are two entry points, and the design needs both:

- **Prefetch (the good path).** On joining a battle room, and on a `BattleUpdate`
  that changes `Game` or `Map`, kick off a background acquisition. The battle
  room's SYNC panel — which today only reports whether an install and engine were
  found (`BattleRoomScreen.jsx:227`) — becomes the progress surface.
- **Preflight (the safety net).** On `ConnectSpring`, before spawning, confirm
  the content is there. If it is not, download it while showing progress, then
  launch. This is the path that must exist even in the MVP, because matchmaker
  games and `RejoinOption` push `ConnectSpring` with no room join beforehand.

`GetCustomGameMode` shapes differ — verified from the two real examples and from
the local `<ZK>\CustomModes\*.json` cache the official client keeps:

```json
{ "shortName": "zeroWars", "name": "Zero Wars",
  "map": "ZeroWars v2.1.9", "rapidTag": "zk:stable" }

{ "shortName": "arenamodv104", "name": "Arena Mod",
  "game": "Arena Mod v1.0.4", "options": {} }
```

`map`, `game` and `rapidTag` are each independently optional. Parse defensively;
a mode with none of them (e.g. the local `techk.json`, which is options only)
needs no content at all.

### 2.2 Knowing whether it is already present

This is the part where a clever design loses to a boring one.

**Why the obvious approaches fail.** Archive *names* are not file names.
`Arena Mod v1.0.10` lives in `arenamodv1010.sd7`; `Supreme-K 2.91` in
`supreme2.91.sdz`; `Zero-K v1.14.8.0` is not a file at all but
`packages\06860629e67e11ef60760893bbfb60d5.sdp` plus 256 pool directories.
Globbing `games/` and `maps/` for the name will produce false negatives, and a
false negative means a redundant multi-hundred-megabyte download.

**Sources of truth, ranked.**

| Source | Accuracy | Cost | Problem |
|---|---|---|---|
| `<ZK>\cache\ArchiveCache20.lua` | exact — 435 archives, name → file | one 2.8 MB parse | it is the *engine's* cache; stale until the engine next scans, so it will not show what we just downloaded |
| `<ZK>\rapid\repos.springrts.com\<repo>\versions.gz` + `packages\<md5>.sdp` | exact for rapid tags and rapid game names | cheap | covers rapid content only |
| file-name globbing | poor | free | see above |
| running pr-downloader | exact, by construction | ~1–2 s and two conditional GETs (§1.7) | needs the network even to say "you already have it" |

**Recommendation for the MVP: run pr-downloader.** It is idempotent, it is the
same code the engine's own tooling uses, it cannot disagree with itself about
what "present" means, and it costs a second. Exit 0 means the content is there
now; that is the answer we actually wanted.

**Recommendation for v2: add a local fast path in front of it.** Parse
`ArchiveCache20.lua` once at startup (it is a flat Lua table literal; a
30-line scanner for `name = "…"` inside `archivedata` blocks is enough, no Lua
interpreter needed) and union it with the set of archives we have downloaded
ourselves this session. A hit means skip the subprocess entirely and go straight
to launch — which also makes the app work offline for content you already have.
A miss falls through to pr-downloader.

Note this also gives us the answer to §1.5's "not found vs failed" ambiguity: on
a non-zero exit, re-run the local presence check. Present → treat as success.
Absent → report not-found.

**The engine binary is a separate question and stays out of scope.**
`install::find_engine` already resolves it and produces a good error. pr-downloader
has `--download-engine <version>`, but whether it accepts Zero-K's version
strings (`2025.06.21`, `104.0.1-567-gc484c10`) and whether ZK's engine builds are
published anywhere it can reach is **unverified and I would bet against it** —
ZK ships engines through its own installer and Steam depot. Keep "engine missing"
as the honest error `find_engine` already writes, and do not attempt engine
downloading in v1 or v2.

### 2.3 The revised state machine

`src/store/game.ts` today goes `ConnectSpring` → `phase: launching` → `launch()`
→ spawn. The new shape inserts two states:

```
idle
  -> preflight   (resolving install, engine, and what content is missing)
  -> downloading (0..n items, cancellable, with progress)
  -> launching
  -> running
  -> failed      (with a reason and, where it makes sense, "Launch anyway")
```

Rules that fall out of the existing code:

- The launch is still driven by the *arrival* of `ConnectSpring`, never by the
  button (`game.ts:71`). Preflight slots in front of `launch()`, not in front of
  `requestStart()`.
- `launch.rs` already refuses a second concurrent game. Content acquisition
  needs the same single-flight guarantee for a different reason (§3.4).
- A retry from `failed` re-runs preflight from `state.last`, which is already
  kept for exactly this.
- **"Launch anyway" must exist.** If our content resolution is wrong — and §1.6
  says it will be for custom mods — the user must still be able to try. Today
  they get a hung engine; tomorrow they must not get a lobby that refuses to
  start a game they can actually play. Default to blocking, always offer the
  override, and word it plainly: *"Shiro could not find `Supreme-K 3.42`. The
  game may fail to start."*

---

## 3. Rust design — `src-tauri/src/content.rs`

A sibling of `launch.rs`, following its conventions: everything up to the spawn
is pure and unit-tested; the spawn itself is the only part that needs a machine
with Zero-K on it.

### 3.1 Types

```rust
/// What kind of thing a name refers to, which decides the flag.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentKind { Game, Map }        // Engine deliberately absent - see 2.2

/// One thing to acquire. `name` is the server's spelling, unmodified.
pub struct ContentItem { pub kind: ContentKind, pub name: String }

/// Everything needed to run pr-downloader, resolved but not yet executed.
/// Mirrors launch::SpawnPlan field for field on purpose.
#[derive(Debug, PartialEq, Eq)]
pub struct DownloadPlan {
    pub exe: PathBuf,
    pub cwd: PathBuf,
    pub args: Vec<OsString>,
    pub env: Vec<(String, OsString)>,
}
```

### 3.2 Pure functions (the testable half)

```rust
/// Build the command line. One invocation carries every item, because
/// --download-* flags are repeatable (verified, docs/DOWNLOADS.md 1.2).
pub fn download_plan(exe: &Path, root: &Path, items: &[ContentItem]) -> DownloadPlan;

/// Reject names that cannot be passed safely, in the spirit of
/// launch::check_value. A rapid tag or archive name never contains a newline or
/// a NUL; refuse rather than mangle so a protocol change surfaces as a message.
fn check_name(name: &str) -> Result<(), String>;

/// One decoded unit of pr-downloader output.
pub enum Line {
    Progress { percent: u8, done: i64, total: i64 },
    Log { level: Level, message: String },   // Level = Info|Warn|Debug|Error
    Other(String),
}

/// Parse a single already-split chunk. Pure, and the place all the format
/// knowledge lives.
pub fn parse_line(s: &str) -> Line;

/// Split a byte chunk on BOTH \r and \n, returning complete units plus the
/// remainder to carry into the next read. This exists as its own function
/// because [Progress] is \r-terminated and a lines() reader never yields it.
pub fn split_chunks(buf: &str) -> (Vec<&str>, &str);

/// Map an exit status to something a human can act on.
pub fn classify_exit(code: Option<i32>) -> Outcome;   // Ok | NotFoundOrFailed | NoDiskSpace | Depends | Killed
```

Unit tests should be written against the strings captured in §1.4/§1.5, verbatim.
Suggested cases, all of which I have real samples for:

- `[Progress]   2% [=                             ] 1/50 ` → `percent 2, 1, 50`
- a run of concatenated `[Progress]` chunks split correctly by `split_chunks`
- `[Info] /build/.../FileSystem.cpp:203:setWritePath():Using filesystem-writepath: C:/…`
  → level Info, message without the file:line:func prefix
- `[Error] /build/.../main.cpp:187:main():Error occurred while downloading: 1`
- a partial chunk at a buffer boundary is carried over, not dropped
- `download_plan` puts `--filesystem-writepath` before the download flags and
  emits one flag per item with the right flag per `ContentKind`
- `download_plan` with zero items produces no `--download-*` flags (the caller
  must not spawn in that case — bare pr-downloader with no items exits 1)
- `classify_exit(Some(5))` → `NoDiskSpace`

### 3.3 Spawning and streaming

```rust
let mut child = Command::new(&plan.exe)
    .current_dir(&plan.cwd).args(&plan.args)
    .stdout(Stdio::piped()).stderr(Stdio::piped())
    .spawn()?;
```

On Windows also set `.creation_flags(CREATE_NO_WINDOW)` — `main.rs` already sets
`windows_subsystem = "windows"` for release, and a console flashing up on every
download would be a visible regression. (`launch.rs` does not need this because
the engine owns the screen anyway.)

Two reader threads, one per stream, each doing `read()` into a `String` buffer,
`split_chunks`, `parse_line`, then emit. Progress events coalesce naturally
because pr-downloader already throttles to 150 ms (§1.4). stderr's thread
forwards only `Level::Error` and keeps the last ~16 KB of everything else in a
ring buffer, which is attached to the failure event so a bug report has the curl
trace without the UI ever showing it.

A third thread `wait()`s and emits the terminal event. Same shape as
`launch.rs`'s supervision thread.

### 3.4 Concurrency and cancellation

**One pr-downloader at a time. This is not an optimisation, it is correctness.**
Two processes writing `<ZK>\pool\` and `<ZK>\packages\` concurrently is
unsupported, and rapid's pool is content-addressed but its `.sdp` writes are not
atomic. `launch.rs` already models "one at a time" with an
`Arc<Mutex<bool>>`; do the same, but with a queue rather than a rejection,
because the second request here is a legitimate user action rather than a
mistake.

```rust
#[derive(Default)]
pub struct Content {
    /// The running job, if any. Held so it can be killed.
    active: Arc<Mutex<Option<Job>>>,
    /// Pending items, deduplicated by (kind, name).
    queue: Arc<Mutex<VecDeque<Job>>>,
    root: Arc<Mutex<Option<String>>>,   // same install override launch.rs keeps
}
```

Dedup matters: joining two battles on the same map, or a `BattleUpdate` that
flaps between two maps, must not enqueue the same download twice.

Cancellation is `Child::kill()` plus draining the reader threads. pr-downloader
writes into the pool incrementally and content-addresses it, so a killed download
leaves a partial pool rather than a corrupt archive; the next run resumes.
**Unverified** — worth confirming on the first real download that a kill followed
by a re-run completes cleanly rather than erroring. If it does not, add
`--rapid-validate --delete` as a repair action (§7).

On app exit, kill the child. An orphaned pr-downloader writing into a Zero-K
install after the lobby has closed is the kind of thing that gets a client a
reputation.

### 3.5 Commands

Three, registered in `lib.rs` beside the existing seven:

```rust
/// Resolve what a launch would need and what is missing, without downloading.
/// Sibling of zks_launch_preview, and belongs on the same settings screen.
#[tauri::command]
pub fn zks_content_preflight(engine: String, game: Option<String>, map: Option<String>)
    -> Result<Preflight, String>;

/// Queue an acquisition. Returns a job id; progress arrives on zks://content.
#[tauri::command]
pub fn zks_content_fetch(app: AppHandle, content: State<'_, Content>, items: Vec<ContentItem>)
    -> Result<String, String>;

#[tauri::command]
pub fn zks_content_cancel(content: State<'_, Content>, id: String) -> Result<(), String>;
```

`Preflight` should carry everything needed to render a useful message without a
second round trip:

```rust
pub struct Preflight {
    pub install: Install,             // reuse install::Install verbatim
    pub engine_ok: bool,
    pub engine_error: Option<String>, // find_engine's existing message
    pub downloader: Option<PathBuf>,  // None if this engine dir has no pr-downloader
    pub items: Vec<ContentItem>,      // what we would fetch
    pub writable: bool,               // probe the install root, see 1.3
}
```

`zks_launch_preview` should gain the same content section, so Settings' "Check
launch setup" answers "and could you download the map?" too. That button exists
because the launch path cannot be exercised without a real install; the same
argument applies here with more force, since content acquisition has *more*
environmental failure modes than the spawn does.

---

## 4. Events and store

### 4.1 Rust side — mirror `relay.rs`

```rust
/// Content acquisition progress, mirrored to the UI.
const CONTENT_EVENT: &str = "zks://content";

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContentStatus {
    Queued    { id: String, items: Vec<ContentItem> },
    Started   { id: String },
    Progress  { id: String, percent: u8, done: i64, total: i64 },
    Note      { id: String, message: String },   // an [Info]/[Warn] worth showing
    Finished  { id: String },
    Failed    { id: String, reason: String, detail: Option<String> },
    Cancelled { id: String },
}
```

Same conventions as `relay::Status` and `launch::GameStatus`: internally tagged,
camelCase, `app.emit(...).ok()` at every site because a failed emit must never
take down a download.

### 4.2 TypeScript side

**`src/net/content.ts`** — the bridge, mirroring `net/launch.ts` exactly: nothing
but `invoke`/`listen` plumbing and the mirrored interfaces. Keeps `store/content.ts`
importable in plain Node for tests, which is the reason `net/launch.ts` is
imported lazily in `game.ts`.

**`src/store/content.ts`** — a zustand store. Note it does **not** call
`registerSlice()`: these are Tauri events, not protocol messages, so it sits
outside the `slices.ts` fan-out and subscribes to `zks://content` once, the same
way `game.ts` subscribes to `zks://game` behind its `listening` flag.

```ts
export interface Job {
  id: string;
  items: ContentItem[];
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  percent: number;
  note?: string;
  reason?: string;
  startedAt: number;
}

export interface ContentState {
  jobs: Record<string, Job>;
  order: string[];                 // newest first, for the Downloads screen
  active?: string;
  fetch(items: ContentItem[]): Promise<string>;
  cancel(id: string): Promise<void>;
  /** Await completion - what game.ts's preflight blocks on. */
  settled(id: string): Promise<Job>;
}
```

Progress at up to ~7 Hz per download is well under the "batch into an animation
frame" threshold ARCHITECTURE §5 sets for the login flood, but the same
discipline applies: write to the store on every event, and let the screen read it
— do not re-render a list per event.

**`src/store/game.ts` changes.** `applyBatch`'s `ConnectSpring` branch and
`launch()` grow a preflight step:

```
ConnectSpring -> set phase "preflight"
              -> zks_content_preflight(Engine, Game, Map)
              -> items.length === 0 ? launch()
                                    : phase "downloading" + content.fetch(items)
                                      -> settled -> launch()  |  failed -> phase "failed"
```

Two things to preserve while doing it: the launch must still fire on *arrival* of
`ConnectSpring` with nothing pressed, and `state.last` must still be enough to
retry the whole sequence.

### 4.3 Tests

The e2e fake server (`tools/e2e/fake-server.js`) already replaces
`window.__TAURI_INTERNALS__`, so it can stub `zks_content_preflight` /
`zks_content_fetch` and push synthetic `zks://content` events. Worth adding to
the 78 checks: a `ConnectSpring` whose map is missing shows progress and then
launches; a failed download shows a reason and a "Launch anyway"; a cancel
returns to idle without launching.

---

## 5. UI surface

Screen 10 is P2 and was never designed (DESIGN_HANDOFF §5, `docs/DESIGN_HANDOFF.md:109`).
We should not wait for a design, and we should not invent a big one. Three
surfaces, in priority order.

**1. In the launch path — required for MVP.** Today `game.ts` goes from
`launching` straight to a spawn, and a missing map means a hung engine. The
minimum replacement is a blocking panel on whatever screen is showing: the
battle title, what is being fetched, one progress bar, `Cancel`, and — once the
attempt fails — `Launch anyway` and `Retry`. The design system already has what
this needs: `Meter` (`src/ds/shiro.js:607`, documented for "download progress"),
and a `downloading` state token already mapped to the `download` icon
(`shiro.js:1703`). No new primitives.

**2. In the battle room — the highest-value surface.** `BattleRoomScreen.jsx`
already renders a SYNC block, and its own comment (line 227) says per-map checks
were waiting on this work. Upgrade it from "Zero-K found via Steam" to three
lines — engine, game, map — each with a tick, a spinner with a percentage, or a
warning with a `Get it` button. This is where the download *should* happen: the
player sits in a room for minutes before the host starts, and a download that
finishes during that time is a download nobody experienced.

**3. The Downloads screen — the nav rail button.** `AppShell.jsx:44-49` currently
routes the download icon to Settings, with a comment explaining why. Give it a
real screen and delete the workaround. Minimum content:

- active job: name, kind, progress bar, cancel
- queued jobs, in order
- recent jobs from this session: name, outcome, and the failure reason if any
- the install path and free disk space, because "why did it fail" is usually one
  of those two
- a `Verify content` action that runs `--rapid-validate --delete` (§7)

There is no persistent download history to design, because there is no download
history — the pool is the history. A session-scoped list is honest and small.

**Also worth doing:** a compact indicator in the existing `StatusBar`
(`AppShell.jsx:55`) — one line, "Downloading map 42%" — so a background prefetch
is visible without leaving the battle list. The status bar already has the
vocabulary for this.

`SettingsScreen.jsx:163-165` currently says Shiro does not download anything.
That copy has to change, and should become the honest new version: what we can
fetch, what we cannot (§1.6), and where the files go.

---

## 6. Failure modes

| Failure | Detection | What the user sees / we do |
|---|---|---|
| **No disk space** | exit 5; `[Error] Insufficient free disk space (%llu MiB) on %s: %llu MiB needed` (string verified present in the binary) | "Not enough space on `D:` — Zero-K needs about 340 MB free." Show the install drive and its free space; pr-downloader also logs `Free disk space: N MB` at startup, so we can warn *before* starting. |
| **No network** | curl errors on stderr, then a non-zero exit | "Could not reach the download servers." Offer retry. Do **not** auto-retry in a loop — same reasoning as ARCHITECTURE §5's rule about login retries. |
| **Content does not exist anywhere** | exit non-zero *and* the local presence check still says absent (§2.2) | Name the thing: "Shiro could not find `Supreme-K 3.42`. It may be a custom mod that only the official lobby can download." Offer `Launch anyway`. This is the §1.6 case and it will be common — write the copy properly. |
| **Corrupt archive / bad pool** | exit 2, or the engine failing after a "successful" download | `--rapid-validate --delete` then re-download. Expose it as a `Verify content` button rather than doing it automatically — a full pool validation over 256 pool directories is not something to run behind the user's back. |
| **Install not writable** | probe the install root before spawning (§1.3) | "Shiro cannot write to `C:\Program Files\Zero-K`. Run the official lobby once, or move your install." Detect this *before* the download, not after. |
| **User quits mid-download** | app exit hook | Kill the child. Partial pool data is expected to be resumable (**unverified**, §3.4). |
| **User cancels mid-download** | `zks_content_cancel` | Back to the previous phase; if this was a launch preflight, back to `failed` with `Launch anyway` still offered. |
| **Two battles want different content** | the single-flight queue (§3.4) | Second request queues behind the first, deduplicated by `(kind, name)`. Leaving a battle room should cancel *its* prefetch if it has not started and is not shared with another job. |
| **Download finishes but the engine still cannot see it** | engine exits immediately, or hangs as it does today | The engine's `ArchiveCache20.lua` is stale after our download. The engine rescans on startup, so this should be fine — but it is the most likely "we did everything right and it still failed" outcome. **Verify on the first real end-to-end run.** |
| **pr-downloader missing from the engine dir** | `find_pr_downloader` returns nothing | Should not happen (it ships with every engine), but say so plainly rather than failing at spawn. |
| **A second pr-downloader running** (the official lobby is open) | not detectable cheaply | Accept the risk. Two writers to the same pool is the one genuinely dangerous case and we cannot prevent the official client from doing it. Mention it in the failure copy for exit 2. |

---

## 7. Scope and estimate

Estimates are engineer-days for someone who has read this document and has a
Zero-K install to test against. They assume the existing `launch.rs` / `relay.rs`
patterns are followed rather than rethought.

### MVP — "the engine never hangs on missing content again"

Delivers: `zk:stable`, the default game, and any map springfiles knows. Does
**not** deliver custom mods (§1.6).

| Work | Days |
|---|---|
| `content.rs`: plan builder, `check_name`, `split_chunks`, `parse_line`, `classify_exit`, `find_pr_downloader` + unit tests | 1.5 |
| Spawn, two stream readers, supervision thread, `zks://content` events, cancel, single-flight queue | 1.5 |
| `zks_content_preflight` + folding it into `zks_launch_preview` / "Check launch setup" | 0.5 |
| `net/content.ts`, `store/content.ts`, `game.ts` preflight states + tests | 1.5 |
| Blocking launch panel with progress, cancel, retry, "Launch anyway" | 1 |
| First real run against the install: verify progress counters, resume-after-kill, and that the engine sees fresh content | 1 |
| **Total** | **7** |

That last row is not padding. Nothing in this feature has ever run against real
hardware, exactly like the launch path (README "Known issues"), and three
specific behaviours in this document are flagged unverified because they can only
be settled by a real download.

### Full feature

| Work | Days |
|---|---|
| MVP | 7 |
| Prefetch on battle-room join + `BattleUpdate` map/game changes | 1 |
| Battle room SYNC panel: per-item state, `Get it`, live progress | 1.5 |
| Downloads screen (screen 10) + nav rail wiring + status bar indicator | 2 |
| `ArchiveCache20.lua` fast path, so a present map skips the subprocess and works offline | 1.5 |
| `Verify content` (`--rapid-validate --delete`) with progress | 0.5 |
| **Spike:** is `zero-k.info/ContentService` usable from Rust? Ask the ZK devs first. | 0.5 |
| ZK ContentService fallback for custom mods and recent maps — *conditional on the spike* | 2–4 |
| Copy pass: settings, failure messages, the Supreme-K case | 0.5 |
| **Total** | **16–18** |

Roughly three to three and a half weeks for the whole thing, of which the last
two rows are the mod-support half and are the ones with real estimate risk.

### What is deliberately not in scope

- **Engine downloading.** §2.2. `find_engine`'s existing error is the right
  answer.
- **Reimplementing rapid.** ARCHITECTURE §7 is right that copying
  `PlasmaDownloader` is the wrong trade. Nothing found here changes that; the ZK
  fallback we may need is one HTTP request for a URL and then a file download,
  not a protocol implementation.
- **A persistent download history or a content browser.** The pool is the
  history.
- **Removing content.** Nobody has asked, and deleting from a shared Zero-K
  install on behalf of the user is a bad first move for a third-party client.

---

## 8. Open questions — the honest list

Ordered by how much they would hurt to get wrong.

1. **Can we reach ZK's `ContentService` for custom mods and recent maps?**
   Blocks mod support entirely. `https://zero-k.info/ContentService.svc` answers
   200 but I did not determine its protocol. Ask the ZK developers before
   spiking it. (§1.6)
2. **Do the `[Progress]` counters mean bytes or files during a real archive
   download?** Affects only display, but a "12/50" rendered as "12 of 50 bytes"
   is embarrassing. (§1.4)
3. **Is a killed download resumable?** Determines whether cancel is safe or needs
   a cleanup step. (§3.4)
4. **Does the engine pick up freshly downloaded content without a rescan
   prompt?** The most likely "everything worked and it still failed". (§6)
5. **Is `--filesystem-writepath` reliably writable on a non-Steam install?**
   Verified writable here; unverified in general. Also unverified: whether
   `SPRING_DATADIR` accepts a `;`-separated list as a fallback. (§1.3)
6. **Why did the shipped binary not print `Failed to find …` when upstream says
   it should?** Cosmetic, but it is the reason §2.2 recommends re-checking
   presence rather than trusting the exit code. (§1.5)

---

## 9. Sources

- `pr-downloader.exe --help`, `--version`, and two live not-found runs against
  `<ZK>\engine\win64\2025.06.21\pr-downloader.exe` — the primary source for
  everything in §1.2–§1.5.
- Format strings extracted directly from that binary (`[Progress] %3.0f%% [%.30s] %lli/%lli `,
  `Insufficient free disk space (%llu MiB) on %s: %llu MiB needed`,
  `Failed to find '%s' for download`).
- [beyond-all-reason/pr-downloader](https://github.com/beyond-all-reason/pr-downloader):
  `src/main.cpp` (argument handling, return values), `src/pr-downloader.cpp`
  (`DownloadStart` return codes), `src/Logger.cpp` (log format, stream routing,
  progress throttling). The binary's embedded paths
  (`/build/src/tools/pr-downloader/src/…`) confirm it is this tree, vendored by
  Recoil.
- [ZeroK-RTS/Zero-K-Infrastructure](https://github.com/ZeroK-RTS/Zero-K-Infrastructure):
  `Shared/PlasmaDownloader/PlasmaDownloader.cs`,
  `Shared/PlasmaDownloader/Torrents/TorrentDownloader.cs`,
  `Shared/PlasmaShared/GlobalConst.cs`, `Zero-K.info/AppCode/ContentServiceImplementation.cs`.
- Live queries to `https://springfiles.springrts.com/json.php` for the coverage
  table in §1.6.
- Local install artefacts: `<ZK>\cache\ArchiveCache20.lua` (435 archives),
  `<ZK>\rapid\repos.springrts.com\*\versions.gz` (50 repos, 30,933 rows),
  `<ZK>\CustomModes\*.json`, `<ZK>\packages\`, `<ZK>\games\`, `<ZK>\maps\`.
- [Custom Modes](https://zero-k.info/mediawiki/Custom_Modes) and
  [Mod Creation](https://zero-k.info/mediawiki/Mod_Creation) on the Zero-K wiki,
  for how custom modes and `.sdz` uploads are meant to work.
