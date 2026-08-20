# An app store, and three apps

**Built.** The launcher is `src-tauri/src/apps.rs` and `src/screens/AppsScreen.jsx`;
the profiler is `profile.rs` and `ProfilerScreen.jsx`; Splaunch is `scenario.rs`
and `SplaunchScreen.jsx`. This is kept as the reasoning, with §9 recording what
building it changed.

Four asks: a place inside Shiro to install apps, and three apps to put in it —
a port of Springen, an updated SpringBoard, and a system profiler with a
graphics check.

Everything marked *measured* was checked on this machine or against the live
repositories on 2026-08-20. Where I have an opinion without evidence I say so.

---

## 0. The short version

1. **These three are not one kind of thing**, and that is the finding that
   shapes everything else. Springen is a native OpenGL window. SpringBoard is
   Lua that runs *on the Spring engine*. The profiler is a Shiro screen. Only
   two of them need installing at all, and the third needs no store.
2. **This is not the plugin problem.** `PLUGINS.md` found that the CSP forbids
   every dynamic-code mechanism, WebAssembly included. None of that applies
   here, because none of these run inside Shiro's webview. This is a
   download-and-launch problem, and Shiro already downloads and launches things.
3. **It trades that problem for a sharper one.** A plugin that cannot run is a
   dead feature; a binary that runs is a binary that runs. Fetching and
   executing third-party executables deserves *more* care than the updater got,
   not less — and the updater already has signatures, an allowlist and a pinned
   public key to copy from.
4. **The profiler is mostly already in hand.** Zero-K's own `infolog.txt`
   carries the CPU core count, the GL vendor and renderer, VRAM, the OpenGL
   version and the anti-aliasing in use. Measured below, from a real log. We
   already read that file — for one boolean.
5. **Springen cannot be embedded and has nothing to download yet.** Its UI is
   `eframe`/`glow`, so it is an OpenGL window, not a web page; and it has **zero
   releases**. But `springen-core` is MIT and a clean library crate, which opens
   a much cheaper option than "port".

**Recommendation:** build the profiler first — it is the smallest, the most
immediately useful, and it introduces no new trust surface. Then decide the
store's trust model deliberately (§3), because everything else depends on it.

---

## 1. What each of these actually is

Measured against the repositories, not inferred from their names.

| | Springen | SpringBoard | Profiler |
|---|---|---|---|
| language | Rust | Lua | — |
| runs as | its own OpenGL window (`eframe` 0.36, `glow`) | the Spring engine, loading a Lua archive | a Shiro screen |
| ships as | **nothing — 0 releases** | `.exe` / `.AppImage` installers, plus assets | — |
| licence | MIT | GPL-ish, per repo | ours |
| last touched | 2026-08-17 | core 2026-08-19; **ZK module 2021** | — |
| needs Shiro to | fetch and run a binary | fetch content and launch the engine | read a file it already reads |

Three delivery shapes, three different integrations. A single "install" button
that means all three is a button whose behaviour nobody can predict.

---

## 2. What the store should be

Not a plugin host. A **catalogue, an acquirer, a launcher, and an updater** for
things that are not Shiro — which is very close to what Shiro already is for
Zero-K itself.

The pieces already exist:

- `zkcontent.rs` — host allowlist, `.part`-and-rename, MD5 verification,
  refusal to write outside the target directory.
- `content.rs` — download jobs with progress, and the preflight that answers
  "what is missing".
- `launch.rs` — starting a process and tracking whether it is running.
- The updater — a signed manifest describing what to fetch, and a public key
  pinned in the binary.

An app entry wants: an id, a name, what it is, where it comes from, how to
verify it, how to launch it, and how to tell whether it is installed. That is a
manifest, and §3 is about who writes it.

**The store should not be a screen full of buttons that shell out.** Every app
here has a different notion of "installed" — a binary on disk, an archive plus
assets in the Spring data dir, or nothing at all — and the store's job is to
know that difference so the user does not have to.

---

## 3. The trust problem, which is the real decision

Shiro would be downloading executables and running them. Say that plainly,
because everything else follows from it.

The updater's model is the one to copy: a manifest listing what to fetch and a
**signature over it**, verified against a public key compiled into the app. An
attacker who controls the download host still cannot make Shiro run their code.

Three ways to source the catalogue, in increasing order of risk:

**a. In-repo, shipped with Shiro.** The list of apps is a file in this
repository, pinned by hash to specific releases. Adding an app is a pull
request. No network trust at all, and no signing key needed for the catalogue
itself — it arrives with the app that already got signed. The cost is that a new
app needs a Shiro release.

**b. Fetched, signed with the updater's key.** A `apps.json` on the `dev`
release, signed the same way `latest.json` is. Apps can be added without
shipping Shiro. Same key, same verification, one more thing that key protects.

**c. Fetched, unsigned, from a URL.** Someone who can serve that URL can run
code on every Shiro machine. Not worth discussing further.

**Recommendation: (a) to start.** Three apps do not need a delivery mechanism,
and the moment the catalogue is remote, the question "who may add an app" has to
have an answer. (b) is a small step from (a) once that answer exists.

Whichever it is, three rules:

- **Verify by hash, pinned in the catalogue**, not by "it downloaded without
  error". `zkcontent.rs` already does this for maps.
- **Never launch anything the user did not just ask to launch.** No autostart,
  no "run after install".
- **Say what is about to happen, with the source.** "Download SpringBoard
  1.1335.0 from github.com/Spring-SpringBoard (14 MB) and run it?" is a sentence
  somebody can decline.

---

## 4. Springen

The port is the ask, and the honest answer is that "port" can mean three very
different amounts of work.

**What it is:** a node-graph map generator — 36 node types, erosion, texturing,
Zero-K metal semantics, and a `.sd7` writer that does not need mapconv. The node
graph *is* the application.

**a. Launch it as a separate program.** Shiro fetches a Springen build and runs
it, exactly as it runs the engine. Cheapest by far, and the node graph arrives
intact.

The blocker is measured and simple: **Springen has no releases.** Nothing exists
to download. That is a Springen change — a build-and-publish workflow, which is
the thing this repository just finished doing for itself and could be copied
across in an afternoon.

**b. Vendor the core and build a Shiro-native UI.** `springen-core` is MIT, is a
library crate, and its dependencies are `rayon`, `serde`, `flate2` — nothing
exotic. It would drop into `src-tauri` cleanly.

But the node graph is the product, and rebuilding it in React is a project on
the scale of the lobby itself. Doing it badly would produce a worse Springen
inside a lobby client, which serves nobody.

**c. Headless generation, in Shiro, from presets.** Vendor `springen-core` and
`springen-archive` and expose the *outcome* rather than the editor: "generate a
random 12×12 map, two teams, mirrored". No canvas, no wiring, one dialog. The
host dialog already searches for maps; this would sit beside it and make one.

**Recommendation: (c), then (a) when Springen publishes releases.** They are not
alternatives — one puts map generation in the lobby where hosting happens, the
other puts the real tool one click away. (b) only makes sense if Springen were
being retired into Shiro, which is not the ask.

---

## 5. SpringBoard

**What it is:** a scenario and map editor that runs *on the Spring engine*,
distributed as an installer with its own launcher, plus assets fetched
separately (`core_v1.zip`, from `content.spring-launcher.com`).

This is the one that fits Shiro best, because Shiro already does every part of
it: acquire content, resolve an engine, write a start script, launch, track the
process. SpringBoard is a game archive with a different name.

**"An updated version" needs one clarification before anything is built.**
Measured: `SpringBoard-Core` was pushed **2026-08-19** and is alive.
`SpringBoard-ZK` — the Zero-K module, which is the one that matters here — was
last pushed **2021-01-28**. So "updated" could mean:

- ship the current SpringBoard, which is already current; or
- update the **Zero-K module** to today's Zero-K, which is a Lua project in
  somebody else's repository and mostly not a Shiro task at all.

I think the second is what is meant, and it is worth being explicit that it is
a different kind of work — Lua against Zero-K's unit defs, not client code.

**Two things to decide:**

- **Its launcher, or ours.** SpringBoard ships with spring-launcher, which
  fetches assets and picks an engine. Shiro doing that itself avoids a second
  launcher on the machine and reuses the download UI; letting spring-launcher do
  it means SpringBoard stays whatever upstream says it is. I lean towards ours
  for the engine and assets, because Shiro already owns the Zero-K data
  directory and a second tool writing into it is how installs get confusing.
- **Which engine.** SpringBoard may want a different engine version than the
  lobby runs. `install.rs` already finds engines by version, so this is a
  question of whether we are willing to fetch a second one.

---

## 6. System profiler and graphics check

**Build this first.** It is the cheapest, it needs no store, no downloads and no
new trust, and it makes the settings screen we already generated from Chobby
actually useful.

**The engine has already profiled the machine.** From a real `infolog.txt` on
this machine, verbatim:

```
Physical CPU Cores: 10
 Logical CPU Cores: 16
GL vendor   : NVIDIA Corporation
GL renderer : NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2
GPU memory  : 8188MB (total) / 5910MB (available)
Initialized OpenGL Context: 4.6 (Compat)
using 8x anti-aliasing and 24-bit depth-buffer
SDL version : 2.0.18
```

We already read this file — for a single boolean, `notNvidiaFromInfolog`, which
decides whether one compatibility toggle is on. Everything above is sitting in
the same file, unread.

So the profiler is a parser and a screen, not native hardware probing. That is a
much smaller feature than it sounds, and a much more accurate one: it reports
what the *engine* saw, which is what actually determines whether the game runs
well.

**The gap, and it is real:** this requires the engine to have run at least once.
A fresh install has no infolog, and the first thing a new player wants is to
know whether the game will work. Options:

- Run the engine briefly to produce a log. Honest, and slow.
- Read the OS directly for a cold profile. Native code per platform, and it
  would disagree with the engine about the GPU on a laptop with two of them —
  which is exactly the machine most likely to have trouble.
- Say "run the game once, then come back". Least work, least satisfying.

**The graphics check** is the second half: given the profile, recommend one of
the six graphics presets already generated from Chobby's settings menu, and say
why. "8 GB VRAM, GL 4.6: High is fine" is a sentence with a reason in it. The
presets exist; the mapping from hardware to preset does not, and would be ours
to invent — upstream has no such thing, so it should be presented as advice,
not as a verdict.

Two things it should also catch, because they are the actual failure modes:

- **The engine fell back to a software or Mesa renderer** — visible in
  `GL renderer`, and the single best predictor of "the game is unplayably slow".
- **The OpenGL version is too old.** Zero-K wants a modern context; a machine
  reporting 2.1 will not run it, and saying so beats a crash.

---

## 7. Order, and what each costs

1. **Profiler and graphics check.** Small. A parser, a screen, and a preset
   recommendation. No store required, no new dependencies, no trust surface.
2. **The store's skeleton, catalogue in-repo.** Medium. Manifest, install-state
   detection, download-with-verify reusing `zkcontent.rs`, and one launch path.
   The profiler can be its first entry, as a built-in with nothing to fetch —
   which proves the shape without downloading anything.
3. **SpringBoard.** Medium, and mostly content acquisition. Blocked on the
   clarification in §5.
4. **Springen headless.** Medium. Vendor two crates, one dialog, writes a
   `.sd7` into the maps directory.
5. **Springen as a launched app.** Small *in Shiro*, blocked on Springen
   publishing releases.

---

## 8. What not to do

- **Do not build a plugin host.** Nothing here needs to run inside Shiro's
  webview, and `PLUGINS.md` is the long version of why you would regret it.
- **Do not fetch the catalogue from an unsigned URL.** §3c.
- **Do not auto-run anything after installing it.** The user asked to install
  it; that is not the same as asking to run it.
- **Do not rebuild Springen's node graph in React** to avoid shipping a binary.
  The graph is the product.
- **Do not write a native hardware probe** before checking whether the infolog
  answers the question. It usually does, and it answers it the way the engine
  sees it, which is the answer that matters.
- **Do not let the store write into the Zero-K data directory by hand.**
  `content.rs` and `install.rs` own that; a second writer is how two tools end
  up disagreeing about what is installed.

---

## 9. What building it changed

**Springen is installable.** It had no releases, which is what §4 was blocked
on. A release workflow now publishes a Windows build to a rolling `dev`
prerelease, and its first build - `Springen_0.1.1_x64.zip` - is pinned in the
catalogue by SHA-256. The hash was verified by downloading the file and hashing
it here rather than by copying the one in the release notes: it is the value
that decides whether bytes become a program, so checking it against the thing it
is meant to check would be circular.

**The catalogue's invariants are tests, not intentions.** An executable entry
either has a download *and* a hash *and* something to run, or an explicit reason
it cannot be installed. A download without a hash fails the build, because that
pairing is the whole security model.

**Unpacking refuses to escape.** A zip is a list of paths somebody else chose.
There is a test that builds an archive containing `../escaped.txt` and asserts
nothing lands outside the app's own directory.

**SpringBoard stayed out.** §5's clarification never came, and it is still true
that the ZK module has not been touched since 2021. It is in the catalogue as
unavailable, with the reason on screen - which is the state the launcher was
designed around, so it earns its place by proving that state reads as a fact
rather than a fault.

**Splaunch has not been launched.** The script writer's output is compared
against Zero-K's own `_missionScript.txt` - sections, keys, and the way values
terminate - but no game has been started from one. That is the next thing, and
it wants doing by hand rather than by a test.
