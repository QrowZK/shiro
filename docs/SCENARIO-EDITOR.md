# A scenario editor for Zero-K

Scope only. Nothing here is built.

The ask: a new tool in the spirit of SpringBoard, rather than an integration of
the existing one. This document works out what that tool would produce, where it
would run, and what it would have to be able to do before anybody would use it.

Everything marked *measured* was checked on 2026-08-20 against a real Zero-K
install at `C:\Program Files (x86)\Steam\steamapps\common\Zero-K` (engine
2025.06.21), against the live `zero-k.info` content service and web site, and
against the SpringBoard and Springen repositories. Claims marked **unverified**
are exactly that. Nothing was launched, nothing in the Zero-K install was
modified, and no connection was made to the lobby server.

---

## 0. The short version

1. **A Zero-K mission is a game archive, and I have one open in front of me.**
   `games/User Interface Tutorial r22.sdz` on this machine is a zip whose
   `modinfo.lua` reads `description = [[Mission Mutator]]`, `modtype = [[0]]`,
   `depend = { [[rapid://zk:stable]] }`. Inside it: `mission.lua`, a 46,619-byte
   serialised Lua table of triggers; `mission_runner.lua`, a 66,867-byte
   interpreter written by "quantum" in September 2008; `project.mission.xml`,
   179,644 bytes of `CMissionLib.Mission` .NET serialisation; and 30-byte stub
   files reading `-- intentionally left blank --` written over Zero-K's own
   `game_over.lua`, `game_end.lua` and `awards.lua`. **The interpreter ships
   inside the mission.** Stock Zero-K does not contain it.

2. **But that is not the system Zero-K actually uses now, and the modern one has
   no archive at all.** The galaxy campaign expresses an entire mission - map,
   teams, AIs, unlocks, start units with orders, terraform, wrecks, map markers,
   objectives and defeat conditions - as **modoptions and per-team custom keys
   in a start script**, each one a base64-encoded Lua table. Stock
   `zk-stable.sdz` ships the gadget that reads them
   (`mission_galaxy_campaign_battle.lua`). Measured: none of those modoptions
   are declared in Zero-K's `ModOptions.lua`. Anyone who can write a `script.txt`
   can set them.

   **This is the finding that decides the whole design.** The most portable form
   of a Zero-K scenario is not a file at all. It is a start script.

3. **The old front door is boarded up while the format is still served.**
   `zero-k.info/Missions` is live, lists community missions going back twelve
   years, and `DownloadFile("Puppy Hell r123")` still resolves to a real
   114,574-byte zip. But in the shipped Zero-K menu the missions tab is
   **commented out** - `luamenu/configs/gameConfig/zk/helpSubmenuConfig.lua`
   has `--{ name = "tutorials", control = WG.MissionHandler.GetControl() }`, and
   `zk/singleplayerMenu.lua` offers campaign, skirmish and load, nothing else.
   The site's own "Design new missions with the Zero-K Mission Editor" link
   points at `/Wiki/MissionEditorStartPage`, which does not exist.

4. **SpringBoard is a map editor that can also place units, and its scenarios do
   not leave it.** Its export produces a standalone Spring *map* `.sdz` with
   pre-placed units and features, loaded by a bundled LuaGaia gadget. **Triggers
   are not exported.** Playing a SpringBoard scenario means running the
   SpringBoard game archive in `play` mode. Its `master` branch has one
   substantive commit between 2024-05-16 and 2026-02-17; the Zero-K module was
   last pushed 2021-01-28.

5. **Shiro is already most of the way to a launcher for this and does not know
   it.** `launch.rs` resolves the install, finds the engine, writes a script and
   spawns; `content.rs` fetches by rapid tag or archive name; `zkcontent.rs`
   resolves anything else through the content service. A scenario "Test" button
   is `zks_launch_spring` with a different script. Two concrete gaps, both
   measured: `connect_script` writes eight lines and `check_value` refuses
   `{`, `}` and `;`, so a full local script needs a different writer; and
   `zkcontent::file_name_for` would reject a mission download outright, because
   `https://zero-k.info/Missions/File/204` has no `.sdz` on the end.

6. **Springen is further along than `APPS.md` recorded, and one crate is the
   piece we actually want.** v0.8.0, MIT, five crates, a Windows installer
   pipeline - still zero GitHub releases. `springen-smf` reads and writes
   SMF/SMT and `springen import` already reads a `.sd7`, a `.sdd` or a bare
   `.smf`. That is exactly the "give me this map's heightmap so I can refuse to
   place a tank in the sea" problem, already solved, in Rust, under a licence
   the user owns.

**Recommendation:** build a **hybrid** - author in Shiro's webview, compile to a
Zero-K start script, test by launching the engine. Target the campaign
vocabulary (§2.2), not the 2008 trigger runner. Do not build a second
SpringBoard, and do not ship Lua into the game in v1. Springen and this stay two
tools sharing `springen-smf`, not one tool.

---

## 1. What SpringBoard actually is

Read from the `master` tarball of `Spring-SpringBoard/SpringBoard-Core` (324
first-party Lua files) and the reStructuredText sources under `doc/source/`,
which are what readthedocs renders.

### 1.1 Architecture

It is **a Spring game archive**. `modinfo.lua` at the repo root:
`name = "SpringBoard Core"`, `shortName = "SB_C"`, `modtype = 1`,
`onlyLocal = true`. The engine loads SpringBoard as the game; there is no host
process, no window of its own, no renderer of its own.

The same `scen_edit/` tree is loaded into **both Lua states**.
`scen_edit/exports.lua` opens with `if WG then SB = WG.SB else SB = GG.SB end`,
and the authoritative model lives synced
(`SB.SyncModel = Script.GetSynced() and sb_gameMode ~= "play"`). Widget and
gadget talk over a command bus with MessagePack serialisation, chunked through
`Spring.SendLuaRulesMsg` one way and `SendToUnsynced` the other. Roughly ninety
`Command` classes, each with `execute`/`unexecute`, which is where undo comes
from for free.

The UI is **Chili** - specifically gajop's fork; all ten git submodules are his.
It launches through **spring-launcher**, gajop's Electron wrapper, whose
`dist_cfg/config.json` declares `"game": "rapid://sbc:test"` and downloads a
Beyond All Reason fork of the engine.

`SpringBoard-ZK` is six real files. Its `modinfo.lua` is the whole story:
`depend = { 'rapid://sbc:test', 'rapid://zk:stable' }`. It is a third game
archive that layers Zero-K's unit defs and models under SpringBoard's editor
code, plus a mex-placement bridge because Zero-K uses discrete metal spots
rather than a metal map.

Measured on this machine, from `rapid/repos.springrts.com/*/versions.gz`
(fetched 2026-08-18): `sbc:stable` is `SpringBoard Core 0.5.5`, `sbc:test` is
`test-1345-72e22e6`, and `sb-zk:test` is `SpringBoard ZK test-27-3f33ef1` with
dependencies `rapid://sbc:test|rapid://zk:stable`. **All three are fetchable by
pr-downloader, which Shiro already shells out to.** Whatever else this document
concludes, installing and launching SpringBoard from Shiro needs no new
acquisition machinery at all - `zks_content_fetch` with kind `Game` and name
`sb-zk:test` is the whole of it. Chobby knows this too: `zkmenu-stable.sdz`
ships `luamenu/widgets/gui_springboard_window.lua`, by gajop, which launches the
archive named by `Configuration.gameConfig.editor` - set to
`"SpringBoard ZK $VERSION"` in the `zkdev` config and absent from the stable
`zk` one.

### 1.2 Feature set

Tabs: Objects, Map, Env, Logic, Misc.

**Map** is the strongest part: heightmap add/set/smooth, texture editing for
diffuse, specular and splat detail normals with blur and sharpen, a void tool,
metal map, grass map. All GPU passes, with GLSL in `shaders/`, fifteen brush
patterns and eight PBR material sets shipped.

**Objects** places units and features in Set or Brush mode, with a property
editor and a collision editor.

**Logic** is areas, triggers and variables. The trigger model is: a trigger has
several events (any fires it), then all conditions are checked, then all actions
run. From `triggers/core.lua` (1,579 lines): **13 events** (`GAME_START`,
`GAME_END`, `GAME_FRAME`, `TEAM_DIE`, `UNIT_CREATE`, `UNIT_DAMAGE`,
`UNIT_DESTROY`, `UNIT_FINISH`, `UNIT_ENTER_AREA`, `UNIT_LEAVE_AREA`,
`FEATURE_CREATE`, `FEATURE_DAMAGE`, `FEATURE_DESTROY`), **about 41 actions**,
**9 unit orders**, and conditions that are not a separate category at all -
they are boolean-returning entries in a `functions` section that doubles as an
expression language, with higher-order `filter` and `map` over arrays.

Areas are **axis-aligned rectangles only** - `{x1, z1, x2, z2}`. No circles, no
polygons.

Three things do not exist. Grepping the whole tree for `objective|briefing|
cutscene` returns **zero hits** in any `.lua` or `.md`. There is no objectives
system, no briefing screen, no cutscene editor; you build those out of
`SEND_MESSAGE`, `WIN_GAME`, `SET_CAMERA_TARGET` and custom Chili dialogs. AI is
effectively absent - `save_project_info_command.lua` hardcodes
`local aiShortName = "NullAI"` for any AI team. And multiplayer is explicitly
discouraged in the getting-started page.

The best feature is **testing**. `start_command.lua` snapshots the model and the
heightmap, flips `sb_gameMode` to `"test"`, and runs the trigger runtime in
place. No reload, no export. `stop_command.lua` restores the snapshot.

### 1.3 What the engine buys it

This is worth being concrete about, because it is the argument for §3.

- **The map's own rendering.** `Spring.SetMapShader`,
  `Spring.SetMapShadingTexture`, `Spring.SetMapSquareTexture`, and a full `gl.*`
  surface - `gl.RenderToTexture` 25 times, `gl.UseShader` 39, `gl.Uniform` 59.
  A terrain brush is a GPU pass, not bitmap arithmetic.
- **The real heightmap and resource maps.** `Spring.SetHeightMap`,
  `Spring.SetHeightMapFunc`, `Spring.GetGroundHeight` (32 uses),
  `Spring.SetMetalAmount`, `Spring.GetGrass`.
- **Real UnitDefs and models out of the game archive.** Units are engine
  objects, so a placed unit is drawn by the same code that draws it in a match,
  at the right size, with the right animation.
- **Live simulation.** `Spring.GiveOrderToUnit` (17 uses), `Spring.SetAlly`,
  `Spring.SetGlobalLos`, `Spring.GetProjectilesInRectangle`. Editing and playing
  share one object graph, which is why the test button is instant.
- **Mouse picking.** `Spring.TraceScreenRay` (24 uses). Clicking terrain to get
  a world position is one call.
- **VFS over archives.** `VFS.Include` 48 times, `VFS.LoadFile` 46,
  `VFS.GetMaps`, `VFS.GetArchiveContainingFile`, `VFS.CompressFolder`. Reading a
  `.sd7` is free.

The docs make the argument themselves in `comparison.rst`, against the Zero-K
Mission Editor: that one "runs as an external tool, while SpringBoard runs
in-engine. This allows SpringBoard to offer WYSIWYG kind of editing, and also
use camera controls that players are already familiar with."

That is true, and it is the honest case for the engine. Note carefully what it
is a case *for*: terrain, models, camera. It is a much weaker case for
"which units may this team build" and "lose if the commander dies", which is
what a Zero-K scenario mostly consists of.

### 1.4 What it produces, and why that matters here

A project on disk is a `.sdd` directory - Spring's uncompressed archive format -
whose `mapinfo.lua` carries `modtype = 3`, i.e. **the project is a map
archive**, with SpringBoard's metadata in a `sb_project_files/` subdirectory.
The model is Lua tables serialised to Lua source; heightmap, metal and grass are
raw binary arrays.

Export has four modes, and only in `dev` mode. The interesting one, "Spring
archive", builds `mapinfo.lua`, compiles the map with `springMapConvNG` through
the launcher host process, vendors `libs/lcs` and `libs/s11n`, adds
`LuaGaia/Gadgets/s11n_gadget_load.lua`, and zips it into a `.sdz`.

So the exported artifact is **a map with pre-placed units and features that any
Spring game can load**. The docs say so: s11n export is for exporting game
objects "and load them in your standalone map".

**Triggers do not survive that export.** Only the s11n loader gadgets are
copied; the trigger runtime is not. There is no "publish" concept anywhere in
the codebase, and no packaging path that ships a `play`-mode bundle to an end
user. Playing a SpringBoard scenario means having SpringBoard.

### 1.5 Health

Created 2013, MIT, 14 stars, 7 contributors of whom one has 1,098 commits and
the next has 30. Five releases; the latest, `v1.1343.0`, is 2024-05-16, and the
docs still link `v1.1335.0`. Between 2024-05-16 and 2026-02-17 there is one
commit on `master`. 96 open issues; the last substantive user-filed one is
2024-09-12. `SpringBoard-Resources` is marked DEPRECATED and the launcher still
downloads 1.8 GB from it. `SpringBoard-ZK`: last pushed 2021-01-28.

The live part is off `master`. A `rust-stable` branch, tip 2026-08-14, is a
substantial in-progress rewrite - commands, events, project save/load/export and
texture IO moved from Lua into native Rust, Chili replaced by RmlUi. Whether it
lands is **unverified**.

---

## 2. What a Zero-K scenario is, as a file

This is the crux, and the answer is that there are three systems with three
different answers, none of them called "scenario". The word does not appear in
Zero-K's, Chobby's or the infrastructure repository's source at all.

### 2.1 The mission mutator - a real format with a boarded-up front door

Measured from `games/User Interface Tutorial r22.sdz` on this machine, 41
entries:

```lua
local modinfo = {
  name        = [[User Interface Tutorial r22]],
  description = [[Mission Mutator]],
  modtype     = [[0]],
  shortname   = [[ZK]],
  depend      = { [[rapid://zk:stable]] },
}
```

`modtype = 0` hides it from the mod list. The archive carries:

| file | size | what it is |
|---|---|---|
| `mission.lua` | 46,619 | the mission, as a serialised Lua table |
| `LuaRules/Gadgets/mission_runner.lua` | 66,867 | the interpreter, `author = "quantum"`, dated Sept 2008 |
| `project.mission.xml` | 179,644 | the C# editor's own project, re-embedded |
| `script.txt`, `script.lua`, `slots.lua` | small | the start script, three ways |
| `LuaRules/Gadgets/game_over.lua` etc. | 30 each | `-- intentionally left blank --` |
| thirteen `LuaUI/Widgets/mission_*.lua` | | messenger, cutscene, countdown, GUI, night |

The runner self-disables with `if not VFS.FileExists("mission.lua") then
return end`. Zero-K itself has no `mission_runner.lua`; every mission brings its
own copy.

`mission.lua` is `{map, players, triggers, startPlayer, disabledUnits,
scoringMethod, counters, regions}`, where each trigger holds a `logic` array of
`{logicType, args, name}` and `logicType` is a literal C# class name. The
vocabulary, counted from the runner: **59 action types** and **25 condition
types**. `CreateUnitsAction`, `GiveOrdersAction`, `AddObjectiveAction`,
`EnterCutsceneAction`, `SetCameraPointTargetAction`, `StartCountdownAction`,
`ModifyResourcesAction`, `VictoryAction`; `UnitsAreInAreaCondition`,
`UnitEnteredLOSCondition`, `CounterModifiedCondition`, `TimerCondition`. It is a
complete mission language and it is older than most of the maps it runs on.

`project.mission.xml` is `z:Type="CMissionLib.Mission"` .NET
`NetDataContractSerializer` output, with an author's own build path
(`G:\Games\Spring\ZK-Missions\kingraptor\uitutorial2`) left in it. The editor
is `Zero-K-Infrastructure/MissionEditor/`, a WPF/C# project, last meaningfully
touched in 2023.

**The publishing pipeline is still live.** `zero-k.info/Missions` lists
community missions with filters for official, singleplayer, coop and
adversarial, and every entry carries
`SendLobbyCommand('@start_mission:<Name> r<Revision>')` and `@host_mission:`.
The archive is a `varbinary(max)` column in one `dbo.Mission` row, served from
`/Missions/File/{id}` by `MissionsController.File`. Measured live:
`DownloadFile("Puppy Hell r123")` returns `resourceType Mod`, one link
`http://zero-k.info/Missions/File/204`, dependencies `["SimpleChess",
"Zero-K v1.4.10.2"]` and a `torrentFileName` carrying the MD5; that URL serves
114,574 bytes beginning `50 4b 03 04`.

**And the client no longer shows any of it.** `gui_mission_handler.lua` exists
in `zkmenu-stable.sdz`, reads `missions/missions.json` from the write dir,
filters to `DisplayName` containing "Tutorial", and is referenced from exactly
one place: a commented-out entry in `helpSubmenuConfig.lua`. On this machine
`missions/missions.json` holds three tutorials, and a live
`GetDefaultMissions` call returns the same three, 4,749 bytes.
`GetScriptMissionData` returns a SOAP fault - `"Sequence contains no elements"`,
thrown at `ContentServiceImplementation.cs:111` - for a real mission name and
for nonsense alike, so no script missions are published today.

### 2.2 The campaign planet - the live system, and the one to target

Zero-K's current single-player is the galaxy campaign, and its missions are
plain Lua in the *menu* archive: 73 files under `campaign/sample/planets/` in
`zkmenu-stable.sdz`, each returning a function
`(planetUtilities, planetID) -> table`. Abridged from `planet69.lua`, which is
the tutorial planet:

```lua
gameConfig = {
    gameName = "Quick Rocket Tutorial",
    mapName  = "FolsomDamDeluxeV4",
    playerConfig = {
        startX = 300, startZ = 3800, allyTeam = 0,
        commanderParameters = { facplop = false },
        extraUnlocks = { "factorycloak", "cloakraid", "staticmex", "energysolar" },
    },
    modoptions = { integral_disable_defence = 1 },
    aiConfig = { { startX = 4000, startZ = 75, aiLib = "Null AI",
                   humanName = "Enemy", allyTeam = 1, commander = false } },
    defeatConditionConfig = { [0] = {}, [1] = { ignoreUnitLossDefeat = true } },
    objectiveConfig = {},
    bonusObjectiveConfig = {},
}
```

Note `gameName`. The campaign happily uses a **legacy mission mutator archive**
as the game it launches - `quicktutorial.sdz` is on this machine, `description =
[[Mission Mutator]]`, and it carries its own `mission.lua` and runner. So the
two systems compose rather than replace.

`api_planet_battle_handler.lua` turns that table into a start script. Everything
nested becomes a base64-encoded Lua table in a modoption or a per-team custom
key:

```lua
local modoptions = {
    commandertypes               = UsefulTableToCustomKey(commanderTypes),
    defeatconditionconfig        = UsefulTableToCustomKey(gameConfig.defeatConditionConfig),
    objectiveconfig              = UsefulTableToCustomKey(gameConfig.objectiveConfig),
    bonusobjectiveconfig         = UsefulTableToCustomKey(gameConfig.bonusObjectiveConfig),
    featurestospawn              = UsefulTableToCustomKey(gameConfig.initialWrecks),
    planetmissionmapmarkers      = UsefulTableToCustomKey(gameConfig.mapMarkers),
    initalterraform              = UsefulTableToCustomKey(gameConfig.terraform),
    fixedstartpos                = 1,
    planetmissiondifficulty      = missionDifficulty,
    singleplayercampaignbattleid = planetID,
}
```

and per team `campaignunlocks`, `campaignabilities`, `campaignunitwhitelist`,
`campaignunitblacklist`, `commanderparameters`, `midgameunits`,
`retinuestartunits`, `typevictorylocation` and `extrastartunits_<n>` in blocks
of forty.

The reader is `LuaRules/Gadgets/mission_galaxy_campaign_battle.lua` in stock
`zk-stable.sdz`, 49,670 bytes, which self-disables the same way the old runner
does:

```lua
local campaignBattleID = Spring.GetModOptions().singleplayercampaignbattleid
if not campaignBattleID and not GG.load_galaxy_mission_handler then return end
```

**None of these modoptions are declared in Zero-K's `ModOptions.lua`.** They are
free-form, read straight off `Spring.GetModOptions()`. Anybody who can write a
start script can set them, against stock, unmodified Zero-K.

The objective vocabulary is measured, from the field names the gadget reads:

- `defeatConditionConfig`, indexed by allyTeam: `vitalUnitTypes`,
  `loseAfterSeconds`, `ignoreUnitLossDefeat`, `defeatIfUnitDestroyed`,
  `timeLossObjectiveID`.
- `bonusObjectiveConfig`, an array: `unitTypes`, `enemyUnitTypes`,
  `comparisionType` (sic - `AT_LEAST` or `AT_MOST`), `targetNumber`,
  `satisfyOnce`, `satisfyForever`, `satisfyForeverAfterFirstSatisfied`,
  `satisfyAtTime`, `satisfyAfterTime`, `satisfyByTime`, `satisfyUntilTime`,
  `victoryByTime`, `completeAllBonusObjectives`, `failOnUnitLoss`,
  `countRemovedUnits`, `onlyCountRemovedUnits`, `lockUnitsOnSatisfy`,
  `capturedUnitsSatisfy`, `alliedUnitsSatisfy`, plus `image`, `description`
  and `experience` for display.
- `typeVictoryAtLocation`: `{x, z, radius, mapMarker}`.

That is not a trigger language. It is a fixed set of dials, and for the kind of
scenario people actually make - "hold this position for four minutes", "kill the
Detriment", "win without losing your commander" - it is enough. Where it is not
enough, there is nothing between it and shipping Lua.

### 2.3 The encoding, which is fragile and worth measuring before trusting

`UsefulTableToCustomKey` is `Base64Encode(TableToString(t))`. The decoder, from
`zk-stable.sdz:luarules/utilities/tablefunctions.lua`:

```lua
dataRaw = string.gsub(dataRaw, '_', '=')
dataRaw = Spring.Utilities.Base64Decode(dataRaw)
local dataFunc, err = loadstring("return " .. dataRaw)
```

Three things follow, all measured.

**The wire format is executable Lua.** `loadstring`, in a synced gadget. Not a
reason to abandon anything - the campaign already does it - but a scenario file
from a stranger is code, and that belongs in the UI copy, not a footnote.

**The alphabet is URL-safe base64.** Both copies of `base64.lua` - Chobby's
`luamenu/addons/base64.lua` and Zero-K's `luarules/utilities/base64.lua` - map
62 to `-` and 63 to `_`, with `=` padding. Confirmed against a real
server-generated script: the `commandertypes` modoption in this machine's
`_script.txt` is 18,916 characters whose only non-alphanumeric character is `=`.

**And the decoder's `_`-to-`=` rewrite collides with the encoder's own symbol
for 63.** `base64bytes['_'] = 63` and `base64bytes['='] = nil`, so a legitimate
`_` in the payload is destroyed before decoding. How often does that matter? I
base64'd Zero-K's own 73 campaign planet files whole: **11 of them produce at
least one `_`**. The real payloads are smaller sub-tables, which is presumably
why this survives in production, but it is not structurally prevented. **A
third-party writer must verify the round trip against a real engine launch
rather than deriving it from the source**, and if it does bite, padding the
serialised table with a trailing space until the encoding is `_`-free is a
legitimate and boring fix.

### 2.4 So: can a third party produce something stock Zero-K will run?

**Yes, two ways, and neither needs the server.**

Drop a correctly formed mutator `.sdz` in `games/` and name it as `GameType` in
a start script, and it runs - the interpreter is inside your own archive, so
`mission.lua` is hand-writable and you control the whole language. The server is
a distribution and scoreboard mechanism, not a gate; nothing in the engine or
the game archive checks provenance.

Or write a start script with the campaign modoptions and no archive at all,
against stock Zero-K. Chobby already exposes this as a supported path for
benchmarks: write `luamenu/startscripts/config.lua`, press a button, and
`api_script_generator.lua` - a near-clone of the planet handler taking an
identical `gameConfig` - generates the script.

The one thing genuinely gated is the *curated list*. `missions/missions.json` is
written by the C# launcher from `GetDefaultMissions`; the campaign's planet list
is compiled into the menu archive and selected from a hardcoded
`campaignConfigOptions = {"sample", "--dev"}`. There is no directory that
Chobby scans for user scenarios. Whatever we build, **Shiro is the front end for
it, because Zero-K does not have one.**

---

## 3. Where the tool should run

Four shapes. The engine gives real rendering, real defs and real simulation; a
webview gives Shiro's UI and no engine dependency. Here is the argument.

### 3.1 Lua on the Spring engine, as SpringBoard does

**Gets:** everything in §1.3. Real terrain with the map's own shaders, real
models at the right scale, mouse picking for free, a test button that is
instant because editing and playing share one object graph, and VFS access to
every archive on the machine.

**Costs:** Lua 5.1 in someone else's widget handler, with Chili or a fork of it;
a game archive to publish on rapid; an engine version to pin (SpringBoard Core's
launcher wants a Beyond All Reason fork; `SpringBoard-ZK`'s config wants 105.0;
Zero-K here runs 2025.06.21, so this is a second engine on the machine); and
zero reuse of anything Shiro has.

**Cannot do:** talk to the lobby. `PLUGINS.md §10.5` measured this - a widget's
only outbound channel to a watching process is `infolog.txt`, and there is no
inbound channel at all once the engine is running. A scenario editor built this
way is a separate application that happens to share a binary with the game.

**And SpringBoard already exists.** Building a second in-engine editor is the
most work for the least differentiation of any option here. If in-engine
authoring is what is wanted, the honest answer is to contribute to SpringBoard's
Zero-K module, which was last touched in 2021 and is six files.

### 3.2 A native tool, like Springen's `eframe` app

**Gets:** full control of the window, real 3D if we write it, direct linkage to
`springen-smf` for heightmaps, a zip reader for `.sdz`, and no CSP, no bridge,
no webview.

**Costs:** a second application to build, sign, install, update and support.
`ARCHITECTURE.md §11` is the long version of why that is not free. It duplicates
Shiro's settings, install detection, download pipeline and launcher. And it
needs an `.s3o` model loader before it can draw a unit as anything other than a
box - Zero-K ships 765 of them, in a format with no Rust reader I know of
(**unverified**; I did not search crates.io).

**Cannot do:** be where the user already is. The scenario a person makes is a
thing they want to send to someone, and the friends list is in Shiro.

This is the second-best option and it is genuinely defensible. It is what I
would pick if Shiro did not exist.

### 3.3 Inside Shiro's webview

**Gets:** Shiro's design system, its navigation, its install detection, its
download pipeline, its launcher, its update mechanism, and cross-platform for
free. No new trust surface: this is first-party code in the bundle, so none of
`PLUGINS.md`'s CSP findings apply - they are about loading *other people's*
code, and there is none here.

The data it needs is all reachable without an engine, and I checked:

- **Unit definitions.** `games/zk-stable.sdz` on this machine is a
  649,726,482-byte **zip** with 8,812 entries, including 275 `units/*.lua`.
  `units/cloakraid.lua` is a plain Lua table with `name = [[Glaive]]`,
  `footprintX = 2`, `maxWaterDepth = 22`, `metalCost = 65`. A zip reader and a
  small Lua-table parser - the one `tools/gen-modoptions.mjs` already needs -
  gets the whole roster.
- **Unit icons.** 366 `unitpics/*.png`, in the same archive. Real Zero-K art,
  no rendering required.
- **Terrain.** The map's `.smf` heightmap, via `springen-smf` (§4). Failing
  that, the minimap image, which Shiro's map catalogue already surfaces.
- **The AI list.** `AI/Skirmish/` in the install, already on disk.

**Costs, and they are real:** no 3D, no shaders, no models, no pathfinding, no
line of sight, no simulation. A unit is an icon and a footprint rectangle on a
shaded heightmap. Every "will this actually work" question is answered by
launching, not by looking.

**Cannot do:** WYSIWYG. Be honest about that in the UI rather than pretending a
top-down icon view is the game.

**One measured caveat that matters.** `zk-stable.sdz` is here because Steam
ships it; this install *also* has `packages/*.sdp` and 256 `pool/` directories.
A rapid-only install may have no readable `.sdz` for the base game at all, in
which case unit defs and icons need a rapid pool reader - which
`MODOPTIONS-EDITOR.md §5` already flagged as its own piece of work. **Unverified
which shape a fresh non-Steam install takes.** This is the first thing to check
before committing to the webview.

### 3.4 Hybrid: author in Shiro, preview by launching the engine

**Gets:** everything in §3.3, plus a test that is arguably *more* honest than
SpringBoard's. SpringBoard tests by mutating a live editor session; we would
test by generating the exact script the player will run and running it. If it
works in the test, it works.

**Costs:** the loop is a process spawn - seconds, not instant - and the engine
takes the screen for the length of it. Nothing comes back except the exit code
and `infolog.txt`.

### 3.5 Recommendation

**The hybrid, targeting the campaign vocabulary.**

The reasoning is not primarily about UI toolkits. It is §0.2: **the output is a
start script**, which is data, and editing structured data is exactly what a
webview is good at. The engine's advantages are overwhelmingly about *terrain* -
shaders, height, models, picking - and terrain authoring is Springen's job, not
this tool's. A scenario editor's real work is "which units may the enemy build",
"where does the second wave arrive", "what counts as losing", and none of that
is improved by being drawn in 3D.

Shiro also already owns every step of the thing the tool has to do at the end:
find the install, find the engine, resolve the map, download what is missing,
write a script, spawn, and come back when it exits. The Test button is
`zks_launch_spring` with a different script.

**What this recommendation cannot do, stated plainly:** no terrain editing, no
3D, no real pathability check, no simulation preview, no cutscene camera work,
and no live "watch it play" without a launch. If any of those is the point of
the feature, this recommendation is wrong and §3.1 is right - and in that case
the answer is to improve SpringBoard rather than to build a rival.

---

## 4. How this relates to Springen

Measured against the repository on 2026-08-20: v0.8.0, MIT, five crates,
`pushed_at` 2026-08-18, **zero releases**. `springen-core` depends on `rayon`,
`serde`, `serde_json` and `flate2`. `springen-archive` writes `.sdd`, `.sdz` and
`.sd7` (via `sevenz-rust2`). `springen-smf` reads and writes SMF and SMT.
`springen import` reads a `.sd7`, a `.sdd` folder or a bare `.smf` and produces
an editable project. There is a Windows build pipeline at
`packaging/windows/build.sh` producing an NSIS installer and a portable zip.

`APPS.md §4` said "Springen has no releases" and recommended vendoring
`springen-core` for headless generation. That still holds. This document adds
two things it did not know.

**One tool or two? Two, and they share `springen-smf`.**

The inputs are different in kind. Springen's input is a node graph that invents
terrain. A scenario's input is a map somebody already made - and most scenarios
will be built on catalogue maps, not generated ones. Requiring the map generator
to write a scenario would be like requiring a paint program to write a caption.

But the scenario editor needs exactly one thing from Springen, and it is a thing
Springen already does well: read a map's heightmap out of its archive, so the
editor can draw the ground, refuse to place a tank in the sea, and put a start
position somewhere flat. That is `springen-smf` plus a little `springen-core`.
Both are MIT, both are the user's, and the dependency set drops into
`src-tauri` without drama. This is a much smaller commitment than "port
Springen", and unlike the port it has an obvious consumer.

**Should the scenario editor consume Springen's `.sd7`?** It will, incidentally,
because a Springen map is just a map. But there is a coupling worth naming:
**a scenario can only be shared if the recipient can get the map.** The only
maps a recipient can reliably get are the ones in Zero-K's catalogue, which
`zkcontent.rs` already resolves. A scenario on a freshly generated Springen map
is a single-machine artifact until that map is uploaded to zero-k.info. So for
v1, scenarios reference catalogue maps by name, and "make a map for my scenario"
is a documented two-step, not a pipeline.

**The interesting direction is the reverse, and it is a v2.** Springen already
writes `mapconfig/featureplacer/set.lua` for geothermal vents, already places
metal spots and start boxes with real validation, and already has a 3D view
where those are dragged. A "scenario" output - the same `.sd7` plus a scenario
file naming it - would make "generate a 12x12 map and a three-objective skirmish
on it" one command. Worth designing towards; not worth building first.

**Do not merge them.** Springen's UI is a node graph in `eframe`; this tool's UI
is a map with things on it in React. Merging means one gets rewritten in the
other's toolkit, and `APPS.md §8` already concluded the node graph is the
product.

---

## 5. Scope

### 5.1 What v1 must do

**Pick a map.** From Zero-K's catalogue, which Shiro already fetches
(`zks_map_catalogue`, `zks_find_maps`). Show the minimap; if the map is
installed, show the heightmap through `springen-smf`. If it is not installed,
offer to fetch it - `content.rs` and `zkcontent.rs` already do that.

**Place units.** Team, `unitDefName`, x/z, facing, and initial commands. The
roster and the icons come from the installed game archive (§3.3). The command
vocabulary is measured from Zero-K's own planet files: `{cmdID, pos, options}`
with `RAW_MOVE`, `ATTACK`, `JUMP`, `PATROL` and the rest of
`planetUtilities.COMMAND`.

**Configure sides.** One human slot, N AI slots from the install's
`AI/Skirmish`, per-team allyTeam, start position, starting metal and energy,
commander presence and level.

**Set unlocks.** `campaignunlocks` per team, plus whitelist and blacklist. This
is the main dial Zero-K's own campaign turns and it is the cheapest way to make
a scenario feel designed rather than random.

**Set win and loss conditions**, from the measured vocabulary in §2.2 and
nothing else. Do not invent a trigger language; expose the dials that exist,
with their real names in the tooltip so a user can search for them.

**Compile and launch.** Generate the start script, write it to temp, spawn the
engine. This is the product; everything above is input to it.

**Save, load, and export one file.**

### 5.2 What v1 should defer

- **Triggers and events.** Both existing vocabularies - SpringBoard's 13/41/60
  and the legacy runner's 25/59 - are real and both require shipping Lua into
  the game, which is gated on the conversation in `PLUGINS.md §10.6`. Design the
  save format so triggers have somewhere to live; do not build them.
- **Terrain editing.** Springen.
- **Cutscenes, briefings and campaign chains.** `Zero-K-Campaign2/sunrise` shows
  the shape a chain takes - a `missiondefs.lua` with a `requiredMissions` DAG
  over start scripts - so this is a later layer over the same output, not a
  rewrite.
- **Multiplayer and co-op scenarios.** The launch would stop being local, and
  local is the whole reason this works without a server.
- **Uploading to zero-k.info.** See §6.5.
- **A mutator `.sdz` exporter.** It is a legitimate second output format - and
  `springen-archive` could write it - but it is a different product and it is
  the one that needs the developer conversation.

### 5.3 What it should never do

- **Never ship our own Lua interpreter into the game archive.** That is a mod
  loader for a competitive RTS, and `PLUGINS.md §10.6` is the argument. Ask
  first, build second, if at all.
- **Never write into the Zero-K install to make a scenario run.** The script
  goes in temp, exactly as `launch.rs:114` already insists, and for exactly the
  same reason - a Steam install under `Program Files` is not reliably writable.
- **Never host a lobby battle.** `IsHost=1; OnlyLocal=1;` is a *local* game with
  no server, which is what every mission and campaign battle in Zero-K already
  uses. That is not the same thing as hosting, `ARCHITECTURE.md §6` is right
  that we never host, and the distinction must survive into the code comments or
  somebody will widen it by accident.
- **Never produce a script the editor cannot re-open.** The script is a build
  output. If it is the save format, the first edit after a reload loses
  everything the script did not need to know.

---

## 6. The unglamorous parts

### 6.1 The save format

JSON, one file, in the app data dir, with an integer `formatVersion` at the top.
Not the start script - the script is lossy, it has no idea what "wave two" is
and it cannot represent an objective the user has written but not enabled.
Springen's `project.json` and SpringBoard's `model.lua` both make the same split
and both are right about it.

The file must be self-describing enough to open on another machine: the map by
catalogue name (not path), the game by rapid tag, and a recorded Zero-K version.

### 6.2 Two kinds of versioning, and the second one is the dangerous one

Ours is easy: bump `formatVersion`, migrate forward, refuse to open a newer one.

**Zero-K's is not.** The campaign vocabulary in §2.2 is read from field names in
a gadget inside `zk-stable.sdz`, and nothing anywhere promises those names.
`bonusobjectiveconfig` is not in `ModOptions.lua`; it is not documented; it is
not a contract. A rename upstream silently turns a working scenario into one
where the objective never completes.

Handle it the way this repository already handles the same class of problem:
**generate the vocabulary from upstream and fail the build when it drifts.**
`tools/gen-settings.mjs` and the proposed `tools/gen-modoptions.mjs` both parse
Lua tables out of Zero-K's repository at a pinned SHA, and
`computedSettingsAreCovered()` fails `npm test` when upstream grows something we
have not ported. A `gen-scenario-vocab.mjs` reading the field names out of
`mission_galaxy_campaign_battle.lua` is the same tool with a different regex,
and it converts a silent breakage into a red test.

Record the pinned Zero-K version in every saved scenario, and say so when
opening a scenario authored against a different one.

### 6.3 Validation, before launch rather than after

A malformed script does not error. It crashes the engine, or it starts a game
where nothing happens, and neither tells the user which field was wrong. So
validate, and refuse:

- every `unitDefName` exists in the installed game archive;
- every position is inside the map's bounds;
- a ground unit is not under water, using the heightmap (`maxWaterDepth` is on
  the unit def - measured, `cloakraid` has 22);
- every team has an allyTeam and every allyTeam has at least one team;
- at least one defeat condition exists on each side, or the scenario cannot end;
- the map and game archives are installed or resolvable;
- the base64 payload round-trips through our own decoder (§2.3).

### 6.4 Testing

The pure half is most of it and it is unit-testable without an engine: table
serialisation, base64, script emission, validation. `zkcontent.rs` already
demonstrates the pattern - pure functions, fixtures captured verbatim from the
live thing, and one `#[ignore]`d test that hits the network.

**The single most valuable test can be written before any UI exists:** take one
of Zero-K's own 73 planet files, run it through our generator, and assert the
output matches a script captured from the real client. Chobby's own emitter is
`MakeScriptTXT` - tables first, then scalars, `\tkey = value;\n` - so a byte-for-
byte match is achievable and would prove the whole chain in one assertion.

The impure half is one launch, and it has to happen early, because §8's first
unknown invalidates the feature if it goes the wrong way.

### 6.5 How somebody shares a scenario

This is the part that gets waved away, so: four routes, measured.

**A file.** The project JSON plus the map's catalogue name. The recipient's
Shiro fetches the map through the existing pipeline and compiles the script
locally. Zero infrastructure, works today, and it degrades honestly - if the
recipient cannot get the map, they are told which map. **This is the v1
answer.**

**A link on zero-k.info.** The mission pipeline is live (§2.1) but it takes a
mutator archive, not a script, and the editor that produces those is a WPF
application. The site's own documentation link is dead. **Unverified** whether
missions can still be uploaded at all; `RegisterResource` exists on the content
service but needs a login and registers a *resource*, not a mission. Worth one
question to the Zero-K developers and not worth guessing about.

**Through the lobby.** Shiro could send the JSON in a DM. Do not. It is file
transfer over a chat protocol, and the moment triggers exist it makes the client
a distribution channel for other people's Lua.

**A rapid tag.** Only if we run a rapid repository, which is a third trust root
and `PLUGINS.md §9.3` already costed that conversation.

One concrete gap to fix on the way: `zkcontent::file_name_for` requires the URL
to end in `.sd7` or `.sdz`, and a mission's URL is `/Missions/File/204`. Any
future work that touches missions has to widen that, and the widening has to
keep the path-traversal refusals it exists for.

---

## 7. What it costs

Engineer-days, for somebody who has read this document. They assume the
`zkcontent.rs` / `launch.rs` conventions - pure logic separated from effects,
fixtures from the real thing - rather than a rethink.

| Work | Days |
|---|---|
| Rust: full local start-script writer, structured rather than `check_value`'d; `UsefulTableToCustomKey` equivalent; fixtures from a real campaign script; the byte-for-byte test in §6.4 | 2 |
| Rust: read unit defs and unit pictures out of the installed game archive (zip + Lua-table parse), with the rapid-pool fallback deferred and named | 2 |
| Rust: vendor `springen-smf`, expose "heightmap and bounds for this installed map" | 1.5 |
| `tools/gen-scenario-vocab.mjs` and the drift guard (§6.2) | 1 |
| TS: project model, save/load, validation, migrations | 2 |
| UI: map picker reusing the catalogue; top-down placement canvas with footprints and a water mask | 4 |
| UI: teams, AIs, unlocks, objectives, defeat conditions | 3 |
| Launch and test loop, reusing `zks_launch_spring` | 1 |
| Share: export/import one file, with the "you need this map" path | 1 |
| First real run against the engine; fix what it says | 2 |
| **Total** | **19.5** |

Roughly four weeks. Two of those days - the archive reader - are worth doing
regardless, because `MODOPTIONS-EDITOR.md §5` wants the same thing for custom
game options.

---

## 8. Risks and unknowns

### 8.1 Verified

The mission mutator format and its 59-action, 25-condition vocabulary, from a
real archive on this disk. The campaign start-script format and its objective
vocabulary, from Chobby's emitter and Zero-K's reader. That the content service
still serves missions and a twelve-year-old community mission still downloads as
a real zip. That Chobby's mission UI is commented out and the campaign menu has
no missions entry. That SpringBoard is a game archive, that its export drops
triggers, and that it and its Zero-K module are on rapid and therefore
installable by machinery Shiro already has. That Springen is MIT, v0.8.0, and
has zero releases.

### 8.2 Unverified, in order of how much it would hurt

1. **That a Shiro-written start script actually launches a working scenario.**
   Nothing was run. Every other conclusion in this document depends on this one,
   and one afternoon settles it: take a planet table from
   `zkmenu-stable.sdz`, generate the script, launch it, see whether the
   objectives appear. Do this before writing any UI.
2. **Whether the base64 `_` collision bites in practice** (§2.3). Measured as
   structurally possible and demonstrated on 11 of Zero-K's own 73 planet files
   when encoded whole; not observed failing. Same afternoon.
3. **Whether a non-Steam Zero-K install has a readable `zk-stable.sdz`** (§3.3).
   If it does not, unit defs and icons need a rapid pool reader before the
   editor can list a single unit.
4. **Whether the Zero-K developers would welcome this.** Two separate
   questions, and the second is the same one `PLUGINS.md §10.6` is gated on:
   is a third-party scenario editor acceptable, and is a scenario that carries
   Lua acceptable. A five-minute answer is worth more than any amount of design
   here. `ARCHITECTURE.md §9` already says to talk to them early; they have
   already said no to us once, about profile endpoints
   (`PROFILES-WITHOUT-ENDPOINTS.md`), so ask rather than assume.
5. **Whether missions can still be published to zero-k.info** (§6.5), and
   whether `@start_mission:` is a lobby command Shiro could usefully handle.
6. **Whether SpringBoard's `rust-stable` branch lands.** If gajop ships a native
   SpringBoard with an RmlUi front end, the calculus in §3.1 changes and this
   document should be re-read.
7. **Whether an `.s3o` reader exists in Rust** (§3.2). Only matters if the
   native option is revived.
8. **Whether Zero-K's autohosts would run a scenario at all.** Out of scope for
   v1, which is local only, but it is the first question anybody will ask once
   v1 works.

---

## 9. What not to do

- **Do not build a second SpringBoard.** It exists, it is on rapid, Shiro can
  install and launch it with machinery that already ships, and Chobby already
  has a window for it. If in-engine editing is the goal, the Zero-K module is
  six files last touched in 2021 and that is where the effort belongs.
- **Do not target the 2008 trigger runner.** It is a complete language and it is
  reachable, but reaching it means shipping a mutator archive with an
  interpreter in it, which is the one thing §5.3 says never to do without asking
  first.
- **Do not invent a trigger vocabulary.** Zero-K has two already. Expose the one
  stock Zero-K reads and let the gaps be gaps.
- **Do not treat the start script as the save format.** It is a build output and
  it is lossy.
- **Do not derive the base64 encoder from reading the source.** The encoder and
  the decoder disagree with each other in a way that is visible in both files
  and apparently survives in production. Verify the round trip against a real
  launch.
- **Do not extend `check_value` to allow braces.** It refuses `; { }` precisely
  so a name cannot forge a different script (`launch.rs:44-54`), and widening it
  reopens the hole. A full script needs a *structured* writer that emits the
  braces itself and escapes only values.
- **Do not merge this with Springen.** Two tools, one shared crate. The node
  graph is Springen's product and a map picker is this one's.
- **Do not build sharing on the lobby protocol.** A DM is not a file transfer,
  and a scenario carries executable Lua.
- **Do not ship anything that writes into the Zero-K install.** `content.rs` and
  `install.rs` own that directory; a second writer is how two tools end up
  disagreeing about what is installed.

---

## 10. Sources

### Zero-K install, read only

`C:\Program Files (x86)\Steam\steamapps\common\Zero-K`, engine 2025.06.21,
portable mode. Read: `missions/missions.json`; `Saves/mission_results.json`;
`_script.txt`; `rapid/repos.springrts.com/{sbc,sb-zk,zk}/versions.gz`. Opened as
zips, to stdout only: `games/User Interface Tutorial r22.sdz`,
`games/Economy Tutorial r17.sdz`, `games/quicktutorial.sdz`,
`games/zk-stable.sdz` and `games/zkmenu-stable.sdz`. Nothing was written,
nothing was launched.

Key files inside those archives: `modinfo.lua`, `mission.lua`,
`LuaRules/Gadgets/mission_runner.lua`, `project.mission.xml`, `slots.lua`,
`script.txt` (mission archives); `luarules/gadgets/mission_galaxy_campaign_battle.lua`,
`luarules/utilities/{tablefunctions,base64}.lua`, `units/cloakraid.lua`
(`zk-stable.sdz`); `luamenu/widgets/{gui_mission_handler,api_planet_battle_handler,api_script_generator,gui_springboard_window}.lua`,
`luamenu/configs/gameConfig/zk/{singleplayerMenu,helpSubmenuConfig}.lua`,
`luamenu/addons/{base64,tablefunctions}.lua`,
`libs/liblobby/lobby/interface_skirmish.lua`,
`campaign/sample/planets/planet{18,69}.lua` (`zkmenu-stable.sdz`).

### Live services, 2026-08-20

`http://zero-k.info/ContentService.svc?wsdl` and `?xsd=xsd0..4`;
`GetDefaultMissions`; `GetScriptMissionData`; `DownloadFile("Puppy Hell r123")`.
`https://zero-k.info/Missions`, `/Missions/Detail/204`,
`/Wiki/MissionEditorStartPage`, and a `HEAD` plus a 16-byte range on
`/Missions/File/204`. **No connection was made to `zero-k.info:8200` and no
login was attempted.**

### Repositories

`Spring-SpringBoard/SpringBoard-Core` (`master` tarball, 324 Lua files, plus
`doc/source/*.rst`), `SpringBoard-ZK`, and the org's release and branch lists
via the GitHub API. `ZeroK-RTS/Zero-K`, `Chobby`, `Zero-K-Infrastructure`
(`MissionEditor/CMissionLib/Mission.cs`,
`Zero-K.info/AppCode/ContentServiceImplementation.cs`,
`Zero-K.info/Controllers/MissionsController.cs`, `ZkData/Ef/Mission.cs`,
`Shared/PlasmaDownloader/ChobbylaHelper.cs`), `Zero-K-Missions`,
`Zero-K-Campaign2`, `Benchmarks`. `QrowZK/Springen` (`README.md`, workspace and
crate manifests, `LICENSE`, tree listing).

### This repository

`docs/APPS.md`, `docs/PLUGINS.md` §2, §10; `docs/ARCHITECTURE.md` §6, §7, §9,
§11; `docs/DOWNLOADS-ZK-CONTENT.md`; `docs/MODOPTIONS-EDITOR.md` §5;
`src-tauri/src/{launch,zkcontent,content,game_files}.rs`.

---

## Appendix: SpringBoard's `.sdd` projects

Asked whether Splaunch should read the old SpringBoard files. Measured against
`Spring-SpringBoard/SpringBoard-Core@master` on 2026-08-21.

**They are `.sdd` *directories*, not `.ssd` files.** A `.sdd` is Spring's
directory archive - a folder the engine mounts as if it were a `.sdz`.
`scen_edit/model/project.lua` puts these inside one:

| file | what it is |
|---|---|
| `project.lua` | name, map, game, mutators |
| `model.lua` | the scenario: placed objects, plus `meta` with triggers, variables, teams, scenarioInfo |
| `heightmap.data`, `metal.data`, `grass.data` | terrain edits |
| `script.txt` | **a start script** |
| `gui.lua`, `textures/`, `screenshot.jpg` | editor state |

Three things follow.

**`model.lua` is parseable with what we already have.** `Model:Save` calls
`table.save`, which is Spring's own `savetable.lua` - "a human friendly table
writer", the same one Chobby's configs use. Its output is a Lua table literal
with `key =`, `["quoted key"] =` and `[n] =` forms, which is exactly the grammar
`tools/lua.mjs` reads for the settings menu and the modoptions table. An
importer would need that reader at runtime rather than build time, which is a
port rather than a piece of research.

**SpringBoard writes a `script.txt` into the project.** Two tools arriving
independently at "a scenario is a start script" is the best evidence available
that §0's finding is right.

**What could not come across, and should be said rather than dropped:** the
triggers would arrive as data nothing interprets yet, and the terrain edits
belong to the *map* rather than the scenario - importing them means rebuilding
the map, not placing units.

**Not built, deliberately.** There is no `.sdd` on this machine to test against,
and the last time this project wrote a reader against a format it had only read
about rather than held - Tauri's `.nsis.zip` - it shipped silently doing nothing.
The format above is from the serialiser's own source, which is the authority,
but a real project from somebody's SpringBoard is what should pin the tests.
