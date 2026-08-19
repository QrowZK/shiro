# A profile screen, and finding people

Scope only. Nothing here is built.

Two asks: a profile screen for yourself and for other players, and a bar at the
top for searching and showing players. They share one question — *what does the
server actually let us know about someone* — so they are scoped together.

Everything in §1 was checked against the protocol and the live site, not assumed.

---

## 0. The short version

1. **Your own profile is already arriving and is already stored.** The server
   pushes it unprompted; `src/store/history.ts` collects it today and the
   friends screen shows a fraction of it. A "me" screen is mostly layout.
2. **Other people's profiles are also already in hand — a *different*, smaller
   set.** Every online user's `User` record carries name, clan, country,
   faction, level, rank and three Elo figures. No request needed for any of it.
3. **You cannot ask for someone else's profile, at all.** `UserProfile` is
   server-to-client only; sending it throws a `RuntimeBinderException` on the
   real server. We hit that for real and `requestProfile` is a no-op because of
   it. So awards, kudos, level-up ratios and Planetwars resources are **yours
   and nobody else's**.
4. **There is no search command in the protocol.** Not for players, not for
   anything. The same wall the map list ran into.
5. That is less limiting than it sounds, because the client already holds
   *every user who is online*. A search over the directory is instant, offline,
   and needs no server support. Anyone not currently connected is the hard case.

**Recommendation:** build the search bar over the local directory and the
profile screen over what we already receive. Be explicit in the UI that another
player's card is thinner than your own, rather than leaving blanks that look
like a loading state. Treat "look up someone who is offline" as a separate
decision — §4.

---

## 1. What we can know

### 1.1 About yourself — the full record

`UserProfile`, pushed by the server via `PublishUserProfileUpdate`, which looks
up `ConnectedUsers[acc.Name]` and sends only to that user:

| field | |
|---|---|
| `Level`, `LevelUpRatio` | progression, and how far into the level |
| `Rank`, `RankUpRatio` | ditto for rank |
| `EffectiveElo`, `EffectiveMmElo`, `EffectivePwElo` | the three ratings |
| `Kudos` | |
| `Awards[]` | per-match awards |
| `Badges[]` | the nine ids in `FriendsScreen`'s table |
| `PwMetal`, `PwDropships`, `PwBombers`, `PwWarpcores` | Planetwars resources |

Already collected in `src/store/history.ts`.

### 1.2 About anyone else — the `User` record

Broadcast for everyone connected, so we hold one per online player:

`Name`, `DisplayName`, `Clan`, `Country`, `Faction`, `Level`, `Rank`,
`EffectiveElo`, `EffectiveMmElo`, `RawMmElo`, `Badges`, `Icon`, `Avatar`,
`IsAdmin`, `IsBot`, `BattleID`, `PartyID`, `AwaySince`, `InGameSince`.

This is more than the current friends panel shows, and it arrives free.

### 1.3 The gap, precisely

Awards, kudos, the two "ratio" fields and the Planetwars resources exist **only**
for you. There is no route to them for another player over the lobby socket.
A profile screen must therefore have two shapes, and should say which one you
are looking at rather than rendering empty rows.

### 1.4 There is no search

No `SearchUsers`, `FindUser` or equivalent in the 76 generated commands. The
client's `useLobby.users` map is the directory, and it is the search index.

What that gives us:

- Everyone online, matched on name, clan or country, instantly and offline.
- Nothing at all about someone who is not connected right now.

---

## 2. The search bar

A field in `AppShell`'s top bar. Typing filters `useLobby.users`; results render
as the `UserChip` the rest of the app already uses; picking one opens the
profile.

Three things worth deciding before building:

- **Match on more than the name.** Clan and country are in the record and are
  what people actually search by ("who from `[ZKF]` is on"). Rank and faction
  are there too if a filter syntax is ever wanted.
- **Cap and rank the results.** The directory is every connected player - a
  hundred or more at peak - and a bare `includes()` over it will match half of
  them for a two-letter query. Prefix matches before substring matches, friends
  before strangers, and a limit.
- **It is not a command palette.** Resist making it search battles, maps and
  settings too. The map field already searches maps and it belongs there.

**Cost:** small. One component, one selector, no protocol work, no Rust.

---

## 3. The profile screen

`FriendsScreen` already has a profile panel — chip, level badge, three ratings,
badges. The screen should be **extracted from it**, not written beside it, or
there will be two renderings of the same record that drift.

Sketch:

- **Header** — avatar/icon, name, clan, country, faction, admin and bot marks,
  presence, and what they are doing now (`BattleID` gives "in a battle"; the
  battle title is in `useLobby.battles`).
- **Ratings** — the three Elos, for anyone.
- **Progression** — level and rank for anyone; the two ratio bars only for you.
- **Badges** — the labels already mapped in `FriendsScreen`.
- **Yours only** — awards, kudos, Planetwars resources, in a section that is
  simply absent for other people rather than empty.
- **Actions** — message, add friend, ignore. These exist already in
  `FriendsScreen` and should move with the panel.

**Cost:** medium, and most of it is the extraction rather than the new screen.

---

## 4. The offline case — decide before building

Everything above works only for someone currently connected. Looking up a
player who is not online needs zero-k.info.

What was checked:

- `https://zero-k.info/Users/Detail/<accountID>` answers 200 and is
  **server-rendered** — the account name is in the returned HTML, not fetched by
  script afterwards. So it is scrapeable.
- Scraping a page nobody promised to keep stable is a maintenance liability, and
  it would be the only place in Shiro doing it. The content service has a
  `GetPublicCommunityInfo` operation nobody has looked at, which may be a better
  answer.

**Recommendation:** ship online-only search first. It covers the common case
("is X on?") without a new dependency. If offline lookup is wanted afterwards,
ask the Zero-K developers for an endpoint before scraping — the same
conversation ARCHITECTURE §9 already says we owe them.

---

## 5. What not to do

- **Do not add a "refresh profile" button.** There is nothing to request. It
  would be a button that cannot work, and the reason it cannot is not obvious
  from the UI.
- **Do not render another player's missing fields as blanks or zeroes.** A
  player with no awards and a player whose awards we cannot see look identical,
  and only one of those is true.
- **Do not key anything on `AccountID` from the lobby alone** until the offline
  case is settled — the two identifier spaces need to line up first.
