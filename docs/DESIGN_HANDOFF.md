# NewLobby — Design Handoff

**For:** product designer
**From:** engineering
**Date:** 2026-08-18
**Status:** ready to start; engineering is building the protocol layer in parallel

---

## 1. What we are building

Zero-K is a free, open-source real-time strategy game with a small, dedicated
player base. Before you play, you sit in a **lobby**: a desktop app where you log in,
chat, browse open games, join one, argue about the map, and hit start. When the match
launches, the lobby hands off to the game engine and waits. When the match ends, the
lobby shows you what happened to your rating.

We are rebuilding that lobby app from scratch.

**The entire point of this project is that it should look and feel good.** We are not
adding features. We are not changing the game. The existing lobby does everything it
needs to do functionally, and we cannot change the server even if we wanted to. This
is a pure design and front-end project: same capabilities, dramatically better
execution.

That is unusual and it is worth saying plainly — **you are the reason this project
exists.** Engineering's job here is to remove every technical excuse for it looking
bad.

---

## 2. Context of use

This shapes everything, so please read it before sketching.

- **It is not the main event.** It is the thing you use *around* the main event. It
  should feel like a well-made foyer, not a second game.
- **Sessions are bursty.** A player might spend 30 seconds here (log in, join,
  go) or 25 minutes (chatting, waiting for a lobby to fill, watching the player
  count creep up). Both need to feel right.
- **It is used while waiting.** A lot of time in the battle room is spent watching
  other people join and waiting for the host to start. Dead time is the dominant
  state. That is a design opportunity, not a problem to hide.
- **It runs alongside or before a graphically intense game.** It should not fight the
  game for attention, and it must not be so heavy it costs frames.
- **Players are experienced and information-hungry.** This audience reads Elo numbers,
  cares about map balance, and will resent a design that hides data for the sake of
  whitespace. Density is a feature here. Make it *legible* density, not *less* data.
- **Small community, high familiarity.** ~100 users were online when we checked on a
  weekday afternoon. People recognise each other's names. Identity and presence matter
  more than they would in a large anonymous game.

---

## 3. Goal and anti-goals

**Goal:** a lobby that a player would screenshot and post, that makes a 12-year-old
open-source RTS feel actively maintained and worth their evening.

**Anti-goals — please actively avoid:**

- Generic dark-mode SaaS dashboard. Cards, soft shadows, purple gradient, rounded
  everything. It would be an improvement over what exists and it would still be a
  failure.
- Sci-fi cliché. Hexagons, angled corner cuts, glowing cyan HUD chrome, scanlines.
  This is the obvious move for an RTS lobby and it is exhausted.
- Reducing information density to look cleaner. See above.
- Anything that requires server changes. We physically cannot ship it.

**The specific thing to beat:** the current lobby is built with an in-engine widget
toolkit that renders inside the game engine itself. It has no real typography engine,
no CSS layout, and skins built from stretched bitmaps. Its look is a *consequence of
those constraints*. We are moving to standard web rendering, so none of those
constraints apply to you. Please audit the current client yourself before starting
(install from zero-k.info) and capture screenshots — your read on what specifically
feels dated is more useful than ours.

---

## 4. Hard constraints

| Constraint | Detail |
|---|---|
| Rendering | Standard HTML/CSS in a desktop shell. Effectively a modern browser. |
| Linux caveat | On Linux we render via WebKitGTK, not Chromium. `backdrop-filter`, container queries and some newer CSS may degrade. **Flag any effect you depend on and we will verify it early.** |
| Window size | Resizable desktop window. Design for **1280×720 minimum**, expect **1920×1080 typical**, must not break at **4K**. Windowed and fullscreen both. |
| Data is server-supplied | Every string, count and colour listed in section 6 is what we get. We cannot add fields. |
| No server changes | If a design needs data the server does not send, it cannot ship. Check section 6 first. |
| Motion budget | Animation is welcome but must idle at near-zero CPU. Long-running ambient animation is fine only if GPU-composited. |
| Text is user-generated | Usernames, clan tags, battle titles and chat are arbitrary user input. Every text slot needs defined overflow behaviour. |

---

## 5. Screen inventory

Priorities: **P0** ships in the MVP, **P1** ships before public release, **P2** later.

| # | Screen | Priority | Notes |
|---|---|---|---|
| 1 | Login / register | P0 | First impression. Also the only place we explain the "Steam users must set a password" caveat. |
| 2 | App shell — nav, presence, online count, connection status | P0 | Persistent chrome around everything else. |
| 3 | **Battle list** (home) | P0 | The default screen. Live-updating list of joinable games. Highest-traffic surface. |
| 4 | **Battle room** | P0 | The hard one. Teams, spectators, bots, map, options, chat, ready/start. Largest and densest screen in the app. |
| 5 | Chat — channels and DMs | P0 | Tabs, user lists, unread and mention states. |
| 6 | Matchmaker queue + ready-check | P1 | Queue selection, live queue stats, and a hard-timed "Are you ready?" modal that interrupts whatever you were doing. |
| 7 | **Post-game debriefing** | P1 | Rating change, awards, rank up/down, XP. Very rich data, currently underused. Big opportunity. |
| 8 | Friends, ignore list, user profiles | P1 | Profile has badges, awards, levels, three separate Elo ratings. |
| 9 | Settings | P1 | Graphics, audio, engine settings, hotkeys. Long-form form design. |
| 10 | Downloads / content progress | P2 | Progress for map and game downloads. |
| 11 | Planet Wars | P2 | Persistent metagame layer. Out of MVP scope; do not design yet. |

Start with **3 and 4**. If those two work, the app works.

---

## 6. Real data reference

This is exactly what the server gives us. Design against it.

### Live snapshot (verified 2026-08-18, weekday afternoon)

```
Users online:  100
Engine:        2025.06.21
Game:          Zero-K v1.14.8.0
```

Expect meaningfully higher on evenings and weekends. Assume the battle list holds
roughly 30–80 entries and design for both a near-empty list and an overflowing one.

### Factions (server-supplied, with official colours)

These come down in the connection handshake. Free brand palette.

| Name | Short | Colour |
|---|---|---|
| Free Machines | Machines | `#e51616` |
| Synthetic Hegemony | Hegemony | `#7292d3` |
| Humanity Rising | Rising | `#a7d224` |

### A user

Everything we know about a person in the lobby:

```
Name, DisplayName, AccountID, Avatar, Icon, Badges[]
Country          two-letter code, for a flag
Clan             clan tag
Faction          one of the three above
Level            integer progression level
EffectiveElo     general skill rating
EffectiveMmElo   matchmaker-specific rating
IsAdmin, IsBot
IsAway           derived from AwaySince timestamp
IsInGame         derived from InGameSince timestamp
IsInBattleRoom   derived from BattleID
PartyID          grouped with friends
```

Note the presence model has **four** meaningful states — online, away, in a battle
room, in a game — plus admin and bot flags, plus party membership. The current client
renders these as small icon variations. There is room to do much better.

### A battle (list row)

```
Title            free text, user-authored
Map              e.g. "Argent_Strata_1.1"
Founder          host username
PlayerCount / MaxPlayers
SpectatorCount
IsRunning        already in progress
RunningSince     timestamp, for elapsed time
Mode             game mode (Teams / 1v1 / FFA / Coop and others)
Password         present if locked
Engine, Game     version strings
IsMatchMaker
```

> **Resolved 2026-08-18.** `Mode` arrives as a number. The full set, with the labels
> the official client displays:
>
> | Value | Label |
> |---|---|
> | 0 | Custom |
> | 2 | PlanetWars |
> | 3 | 1v1 |
> | 4 | FFA |
> | 5 | Cooperative |
> | 6 | Teams |
>
> Six modes, and that is the complete list — the battle row's mode column will never
> hold anything else. Note "Cooperative" is the official label; the internal name is
> `GameChickens`, so don't design around the identifier.

### Battle room contents

```
Players[]     each with AllyNumber (team), IsSpectator, Sync status, JoinTime
Bots[]        AI players, with owner and AI type
Options{}     mod options — arbitrary key/value pairs set by the host
MapOptions{}
```

Teams are `AllyNumber` groupings. Supports up to 16 ally teams. Real games are
commonly 2 teams of up to 8–16, or free-for-all with many small teams. The room must
handle 1v1 and 16-way FFA in the same layout.

### Post-game debriefing — the richest data we have

Per player, after every match:

```
IsInVictoryTeam, AllyNumber
EloChange, NewElo
NewRank, IsRankup, IsRankdown
PrevRankElo, NextRankElo      -> progress toward next rank
XpChange, NewXp
PrevLevelXp, NextLevelXp      -> progress toward next level
IsLevelUp
Awards[]                       named awards with description + value
RatingCategory
```

This is a full progression-and-rewards payload arriving at the emotional peak of the
session, and the current client barely uses it. **Consider this the highest-leverage
screen in the app after the battle room.**

### Chat

```
Text, User, Time
Place        channel / private / battle
IsEmote      "/me" style message
Ring         an attention-grabbing ping directed at you
```

### Available image assets

Map images, served over HTTPS, verified working:

```
Thumbnail   https://zero-k.info/Resources/<MapName>.thumbnail.jpg   ~13 KB
Minimap     https://zero-k.info/Resources/<MapName>.minimap.jpg     ~140 KB
```

Use the thumbnail in list rows and the minimap in the battle room.

**Map names come in two forms, and this matters for design.** The server sends
readable names with spaces — `Adamantine Mountain 2`, `Lonely Oasis v1.1`,
`Akilon Wastelands ZK v1` — while the image files use underscores. Engineering
handles the URL side; what you get to decide is the display form. The spaced
version is much more readable, so that is what is shown today.

Either way the **version suffixes are part of the name** — `v1.1`, `1.03`,
`ZK v1`, `Beta` — and they look untidy in a UI. Real examples from one weekday
afternoon: `Pinch Point 1.03`, `Chicken Nuggets v5`, `Requiem Outpost 1.0`,
`TheBeachBeta`. Note the last one has no spaces at all, so any rule you invent
has to survive both shapes. Worth deciding how to present them.

Users also carry `Avatar`, `Icon` and `Badges[]` string identifiers. We have not yet
confirmed how those resolve to image URLs; assume they exist and we will supply the
scheme.

---

## 7. States to design for

Please cover these explicitly. Most lobby clients get the happy path right and
everything else wrong, and the failure states are a large fraction of real use.

**Connection**
- Connecting / reconnecting with backoff
- Disconnected, with a clear path back
- Server full, banned, invalid credentials — each needs distinct, non-alarming copy

**Loading**
- Initial post-login flood. Measured live on 2026-08-18 with 43 users online: ~90
  messages in 4 seconds — 41 users, 20 backlog chat lines, 16 battles, plus friends,
  ignores, matchmaker and profile. At a weekend peak that scales to several hundred.
  Design the transition from empty to populated so it does not read as a flash. Note
  chat backlog arrives in the same burst, so the chat pane fills with history before
  any live message lands.
- Map images load asynchronously and may 404 for new maps. Needs a defined fallback.

**Empty**
- No battles open (genuinely happens at off-peak hours). This is an important state —
  it is when the game feels dead, and design can meaningfully soften that.
- No friends added; empty chat channel; no match history.

**Density extremes**
- Battle list with 3 entries vs 80
- Battle room with 2 players vs 32
- A username at 1 character and at maximum length
- A clan tag plus country flag plus badges plus away icon on one row
- Chat message that is a single emote vs a 500-character wall

**Interruption**
- Matchmaker ready-check is a hard-timed modal that can appear over any screen.
- Game launch: the app hands off to the engine and effectively goes dormant, then
  comes back with results. Design both the handoff and the return.

---

## 8. What we need from you

In rough order:

1. **Audit + point of view.** Screenshots of the current client and a short written
   read on what specifically is wrong. This aligns us before pixels.
2. **Direction concepts.** 2–3 distinct visual directions, each shown on the **battle
   list** (screen 3), because it is the most representative surface. Enough to choose
   between, not full systems.
3. **Design system.** Once a direction is picked: type scale, colour tokens (light and
   dark if we are doing both), spacing scale, elevation, motion principles, iconography
   approach, and the component inventory. Delivered as tokens we can implement directly
   as CSS custom properties.
4. **Screen designs**, P0 first: battle list, battle room, app shell, chat, login.
5. **States**, per section 7, for the P0 screens.

**Format:** Figma preferred. Whatever the tool, we need exportable tokens rather than
values read off a canvas.

**Constraint check:** please flag anything depending on `backdrop-filter`, heavy
blur, container queries, or continuous animation, so we can verify it renders on
Linux before you build on it.

---

## 9. Open questions

For you:

- Light mode at all, or dark only? Dark is the genre default and the game is dark.
  Light mode roughly doubles the token and QA work.
- How hard do we lean on the three faction colours as a brand system, given a player's
  faction is a persistent identity but only three values exist?
- Map version suffixes (`_v1.4`, `_2.2.3`) — strip them for display, or keep them
  because players genuinely distinguish map versions?

For engineering to resolve, tracked:

- ~~Full `Mode` enum mapping for battle types~~ — **resolved 2026-08-18**, see §6
- Resolution scheme for `Avatar`, `Icon` and `Badges[]` image assets
- Whether we support light mode, pending the answer above

---

## 10. Reference

The current client is open source and worth browsing for *functional* completeness —
what a screen must contain — while ignoring its visual execution entirely.

- Current lobby (Chobby): https://github.com/ZeroK-RTS/Chobby
- Server / protocol: https://github.com/ZeroK-RTS/Zero-K-Infrastructure
- The game: https://zero-k.info

For scale: the current battle room is ~1,900 lines of UI code and the settings screen
~1,800. That is the functional complexity we are re-housing, not reducing.
