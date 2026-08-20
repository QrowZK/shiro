# A modoptions editor

Scope only. Nothing here is built.

"Implement modoptions from the ZK client." Zero-K's client has a modoptions
panel; Shiro shows the raw dictionary and nothing else. This is what it would
take to close that gap, and the two places where the answer is not what you
would expect.

Everything below was checked against the server source, the game repo and a real
install. Nothing here is inferred from how it looks.

---

## 0. The short version

1. **The option list is a Lua table we can generate from, exactly like the
   settings menu.** Zero-K's `ModOptions.lua` is 90 options in 7 sections, all
   fully specified — every number has `min`, `max` and `step`, every option has a
   section and a description. Same shape `tools/gen-settings.mjs` already parses.
2. **You can only edit options in a room you host.** The server refuses everyone
   else, including via chat commands. This is not a limitation we can design
   around — it is the rule, and the UI has to reflect it.
3. **`SetModOptions` replaces the whole dictionary, it does not merge.** Send a
   partial map and everything you left out is gone. This has a real casualty:
   the server sets `noelo` itself for non-vanilla games, and a careless editor
   would silently re-enable rating on a modded room.
4. **Options for games other than Zero-K are out of reach for now**, and the ZK
   client only reaches them because it runs inside the engine. Details in §5.
5. There is a free win on the way: the same generated table gives every player a
   room panel with real names and descriptions instead of `deathmode = allunits`.

**Recommendation:** generate the table, ship the read-only improvement to
everyone, and put the editor behind "you are the host". Treat non-Zero-K games
as a later phase with its own decision.

---

## 1. Where the options come from

Zero-K's `ModOptions.lua`, at the root of the game repo. 1147 lines.

The obvious worry is that Chobby's bundled copy and the game's real file have
drifted. They have not — the two are **byte-identical**, md5
`f4cc33ebe38b374db3ffff39e5dfa206`. Chobby's copy *is* the game's file. So
generating from the game repo is exactly as accurate as what the ZK client
ships, and is the more honest pin.

What the table holds:

| | |
|---|---|
| 97 entries | 7 of them `type = 'section'` headers |
| 90 real options | 41 number, 30 bool, 10 list, 9 string |
| plus 18 more | `tweakunits1..9`, `tweakdefs1..9`, appended by two `for` loops |

The 18 are all marked `noLobby = true` — base64 code blobs, deliberately not
lobby-editable. Chobby skips them and so should we.

That matters for the generator: they are added by loops *after* the literal
table, so a parser that reads the literal only will miss them — which is the
correct outcome here, but it must be **deliberate and asserted**, the way
`computedSettingsAreCovered()` fails the build when upstream grows a setting we
have not ported. Silently missing future non-`noLobby` additions is the failure
mode to design against.

The data is unusually clean. All 90 options have a section and a description;
all 41 numbers have `min`, `max` and `step`; list items are uniformly
`{key, name, desc}`. There are no special cases to handle.

Sections, in file order:

| section | options |
|---|---|
| Important | 9 |
| Start | 12 |
| Map | 12 |
| Multipliers | 17 |
| Silly | 7 |
| Experimental | 19 |
| Chicken | 14 |

---

## 2. Who is allowed to change them

This is the part that shapes the feature, so it is worth being exact.

The server, in `ConnectedUser.Process(SetModOptions)`:

```
if ((bat.FounderName != Name || bat.IsAutohost) && !User.IsAdmin)
    "You don't have permissions to change mod options here"
```

So: **the room's founder, and nobody else.** Not spectators, not players, not
the room's regulars.

The obvious next thought is the chat route — autohosts take `!` commands, so
surely `!setoptions` works. It does not. `CmdSetOptions` is
`AccessType.NotIngameNotAutohost`, and the server's own refusal text spells out
the situation:

> This command cannot be used on autohosts, either ask a moderator to change the
> settings or create your own host.

There is no vote path, no poll, no workaround. **In an autohost — which is most
public rooms — modoptions cannot be changed by anyone.**

### 2.1 Knowing this client-side, without a new protocol field

`BattleHeader` carries no `IsAutohost`, so the flag itself is not visible. It
does not need to be. Reading the server rule backwards, you are permitted iff:

```
(FounderName == me && !IsAutohost) || IsAdmin
```

and an autohost's founder is never a human — the server renames it to
`"Autohost #<BattleID>"` on creation, and database autohosts run under their own
bot accounts. So `founder === myName` is **sufficient on its own**. We already
have `battle.Founder` and already compute `host:` per player in `roomModel()`
(`src/store/adapters.ts:331`). No protocol work.

This lands well with the rest of the client: the host dialog we just built
creates exactly the rooms where the editor is usable.

---

## 3. The replace trap

`ServerBattle.SetModOptions` is two lines:

```
ModOptions = options;
await server.Broadcast(Users.Keys, new SetModOptions() { Options = options });
```

Assignment. Not a merge. Our store already models this correctly and there is a
test naming it — `"mod options are replaced wholesale, because SetModOptions is
a snapshot"` (`src/store/room.test.ts:99`) — but that test covers *receiving*.
Sending is new, and gets it wrong by default.

The casualty is concrete. `ServerBattle` sets `ModOptions["noelo"] = "1"` itself
when the hosted game is not vanilla Zero-K, and announces it: *"Ratings are
disabled, since this game is not vanilla ZK"*. An editor that sends only the
options it has controls for would drop `noelo` and quietly re-enable rating on a
modded room — a change nobody asked for, from a menu that never mentioned it.

The ZK client avoids this without ever addressing it directly: its working copy
is seeded from the room's current dictionary
(`localModoptions = CopyTable(battleLobby:GetMyBattleModoptions())`), edited in
place, and sent whole. Server-set keys survive because they were there when the
copy was taken.

**Do the same.** Seed from `useRoom.modOptions`, mutate, send the whole map.
Unknown keys — anything the server or a custom mode set that our table has no
control for — must be carried through untouched, not dropped for being
unrecognised. That is a test worth writing before the UI exists.

---

## 4. Values are strings, and the formatting is load-bearing

Every value in the dictionary is a string. The encodings, from the ZK client:

- **bool** → `"1"` / `"0"`
- **list** → the item's `key`
- **string** → itself
- **number** → `TextFromNum(n, step)`: decimal places from the step
  (`<0.01`→3, `<0.1`→2, `<1`→1, else 0), then trailing zeros and any trailing
  `.` stripped

That last one is not decoration. Defaults are compared **as strings** to decide
whether an option is non-default, so `"0.60"` and `"0.6"` are different answers
to "did the host change this?". Zero-K's steps include `0.01`, `0.05`, `0.1` and
`0.5`, so the branch is exercised in practice. Port it with tests.

Worth noting the server does *not* validate on this path — `Process()` assigns
whatever it is given. `!setoptions` validates against the hosted game's real
option list, the protocol route does not. So malformed values fail later, in the
game, where the error is much harder to read. Validate on our side.

---

## 5. Games that are not Zero-K

The server validates chat-set options against `battle.HostedModInfo.Options` —
the *hosted game's* list, from unitsync. For Supreme-K or Fatal Wars that is not
Zero-K's list.

Three routes, measured:

**The content service does not have this.** `ContentService.svc` has 14
operations; the word "Option" does not appear anywhere in its five schema
documents. `GetResourceData` returns names, dependencies and hashes, not option
metadata. This is a dead end, not an unexplored one.

**The ZK client reads the archive through the engine.**
`Configuration:GetModoptions(gameName)` goes through Spring's VFS, which Chobby
has because it *is* a Spring widget. Notably the ZK-default path deliberately
avoids it — the comment reads "Don't make the functioning of the base game
depend on the VFS ... working correctly" — and uses the bundled copy instead.
The alternative `WrapperLoopback.GetResourceInfo` path exists but is commented
out. So even upstream, the bundled-file route is the trusted one.

**We could read the archives directly, and it half works.** Checked against a
real install (42 game archives). `.sdz` is a zip; `ModOptions.lua` sits at the
root. FutureWars, `s44_zkc`, `relic-k` and `supreme 0.992` all carry one and
open fine with nothing but a zip reader. But the *current* Supreme-K builds —
2.86, 2.88, 3.36, 3.54 — **do not**. They are mutators that inherit Zero-K's
options through their `ModInfo.lua` depends, so getting their real list means
resolving the dependency chain and falling back to the base game. And Zero-K
itself is not an archive at all: it lives in the rapid pool
(`packages/*.sdp` + 256 `pool/` directories), which needs its own format reader
before you can extract a single file.

**Recommendation:** ship Zero-K's list, generated. It is what the ZK client
trusts for Zero-K, it covers essentially every room where editing is permitted
anyway, and it needs no new machinery. If custom-game options are wanted later,
`.sdz` reading plus depends-resolution is a self-contained follow-up — and the
honest interim behaviour is to show the room's raw dictionary for a game we have
no table for, rather than showing Zero-K's controls over someone else's game.

---

## 6. What to build

**Generator** — `tools/gen-modoptions.mjs`, pinned to a game-repo SHA, emitting
`src/protocol/modoptions.ts`. Reuses the Lua reader from `gen-settings.mjs`.
Skips `type = 'section'` into structure and `noLobby` entirely, and fails loudly
if the file grows entries the literal-table parse would miss.

**Value layer** — `src/net/modOptions.ts`: `defaultFor(option)`,
`formatNumber(n, step)`, `isDefault(key, value)`, and `merge(current, edits)`
preserving unknown keys. Pure functions, unit tested, no React. This is where §3
and §4 are enforced, and it should exist before any component does.

**Read-only panel, for everyone.** The room currently renders
`Object.entries(modOptions)` as raw key/value pairs
(`src/store/adapters.ts:362`). With the table in hand it can show names, grouped
by section, with non-default values marked — which is what the ZK client shows
non-hosts too. This is the cheapest part and the part every player sees.

**Editor dialog, for the host.** Sections down one side, controls on the other;
a checkbox, a select, a number field with min/max/step, and a text field are the
whole vocabulary. Reset-to-defaults, and an explicit apply that sends once — not
a send per keystroke, which would broadcast to the whole room on every click.
The ZK client's Accept/Reset shape is the right one and is already proven
against this server.

**Where it hangs.** The room screen, next to the game and map, disabled with a
reason when you are not the host — "only the host can change these" is
information; a missing button is a mystery.

**Cost:** medium. The generator and value layer are a day's careful work with
tests; the read-only panel is small; the dialog is the bulk of it. No Rust, no
protocol changes, no new dependencies.

---

## 7. What not to do

- **Do not send on every control change.** Every send broadcasts `SetModOptions`
  to every user in the room. Batch behind an apply.
- **Do not drop unrecognised keys.** See §3 — `noelo` is the one that bites, and
  custom game modes set keys of their own through `mode.options`.
- **Do not show the editor in autohosts, or hope the send works.** The server
  refuses, and the refusal arrives as a chat line the user may never see.
- **Do not build a tweakunits/tweakdefs UI.** They are `noLobby` for a reason;
  upstream hides them and they are base64 code blobs, not settings.
- **Do not render Zero-K's controls over a game we have no table for.** Show the
  raw dictionary and say so. Wrong labels are worse than no labels.
