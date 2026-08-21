# Profiles, without the endpoints

**Built.** `src-tauri/src/zkweb.rs` reads the pages, `src/net/zkweb.ts` and
`src/hooks/useWebProfile.js` bring them into the profile screen, and the map
catalogue from §1 is in `zkcontent.rs` as `zks_map_catalogue`. This is kept as
the reasoning; §8 records what building it changed.

`PROFILE-AND-SEARCH.md` §4 said: ship online-only search first, and *"ask the
Zero-K developers for an endpoint before scraping"*. They were asked, and said
no — explicitly declining to give a reason. So that route is closed and this
document replaces §4.

Everything below was measured against the live site today, not assumed.

---

## 0. The short version

1. **Their own public API does not solve this**, and now we know rather than
   guess: `GetPublicCommunityInfo` returns the **top ten** ladder entries, ten
   news items, ten forum items and 343 map items. Useful, but not profiles.
2. **`/Users/Detail/<name>` takes a name directly.** No ID lookup, no search
   page, no login. `PLT_Godde` and `Stuart98` return their own distinct pages.
3. **A miss is clean and cheap**: 40 bytes of `Invalid account (neither an ID
   nor name)`. That is a far better not-found signal than the map pages gave us,
   where a nonsense name returned a byte-identical page to a real one.
4. **robots.txt permits it.** It exists, and disallows exactly five paths —
   forum search, clan join, new post, edit history, PlanetWars clan. `/Users` is
   not among them. This is the site operator's own machine-readable statement
   about automated access, and it does not exclude what we need.
5. **The page carries more than the lobby protocol will ever tell us**, for
   *any* player: awards with counts, games played and watched, first and last
   login, level with XP remaining, rank by name, clan, badges, forum karma, and
   the last ten battles.
6. **Elo history is available as data, not a picture.**
   `/Charts/Ratings?RatingCategory=N&UserId=<id>` embeds the full series as
   `{x: moment("2018-01-20"), y: 2668.475}` — 774 points for one account.

**Recommendation:** build it, in Rust beside `zkcontent.rs`, as a cache-first
reader with a pinned parser and honest degradation. Identify ourselves in the
User-Agent and keep the request rate low — see §5, which is the part worth
disagreeing about if you are going to disagree with any of it.

---

## 1. What their API actually gives (so we stop wondering)

`GetPublicCommunityInfo` takes no arguments and answers 200 with ~180 KB:

| | |
|---|---|
| `LadderItems` | **10** — `AccountID`, `Name`, `Clan`, `Country`, `Level`, `Icon`, `IsAdmin` |
| `NewsItems` | 10 |
| `ForumItems` | 10 |
| `MapItems` | **343** — full map metadata, `ResourceID` included |

Two things worth keeping even though they do not solve profiles:

- The ladder rows are the only **name → AccountID** mapping in a supported API,
  and they carry `Icon` as `"7_7"` — the same `<levelBracket>_<rank>` grid
  `src/net/ranks.ts` already reads. Independent confirmation of the rank colour
  work. (Upstream's `Account.GetIconName()` settles what the second digit is:
  the account's rank, not a rating band.)
- 343 `MapItems` with `ResourceID` is a map catalogue we currently ask
  `FindResourceData` for one name at a time. That is a separate improvement, and
  it is the thing that would let map links reach a map's *own* page instead of a
  search — the compromise made in the map-links fix.

`GetSpringBattleInfo` is `SpringBattleID`, `Title`, `AutohostMode`,
`IsMatchMaker`. Not match history. The other twelve operations are content
delivery.

---

## 2. The page, and why it is addressable by name

The route accepts either form:

```
/Users/Detail/86744        -> the account with that ID
/Users/Detail/PLT_Godde    -> the account with that name
```

Verified the way the map-link bug taught us to verify — a real name, a
*different* real name, a nonsense name, and an empty one:

| request | result |
|---|---|
| `PLT_Godde` | 32,153 b, mentions `PLT_Godde`, never `Stuart98` |
| `Stuart98` | 33,043 b, mentions `Stuart98`, never `PLT_Godde` |
| `zzzznosuchplayerzzzz` | **40 b**, `Invalid account (neither an ID nor name)` |
| *(empty)* | the same 40 bytes |

So the route genuinely resolves, and a miss costs 40 bytes and is impossible to
mistake for a hit.

**It is case-sensitive.** `plt_godde` and `PLT_GODDE` both miss. Names from the
lobby are exact, so following a player from the roster is safe; a name somebody
*types* is not, and needs the online directory to correct the casing first. That
is a real constraint on the search box, not a footnote.

**No login.** `/Users` (the list) 302s to `Home/NotLoggedIn`, but
`/Users/Detail/...` does not. We only ever need the detail page.

---

## 3. What is on it

All server-rendered — the name is in the returned HTML, nothing is fetched by
script afterwards. Measured on one real account:

| | |
|---|---|
| Level | `Level 183`, progress 46%, `XP remaining for level 184: 3963` |
| Rank | name (`Singularity`) and icon (`/img/ranks/7_7.png`) |
| Awards | **29** trophy types with counts — `Complete Annihilation 4729`, … |
| Activity | `8242 played, 6657 watched, 6 missions` |
| Last battles | ten, each with battle ID, player count and map |
| Dates | `First Login: 15 years ago`, `Last Login: 33 hours ago` |
| Clan | name, icon, and `/Clans/Detail/<id>` |
| Badges | `nicetitle` labels — `Silver donator`, `Top 3 player` |
| Avatar | image path |
| Forum | `1476 posts in 273 threads`, karma `+2041 / -27` |
| AccountID | recoverable from the by-name page, via `UserId=` links |

Compare that with `PROFILE-AND-SEARCH.md` §1.3, which said awards and kudos
"exist **only** for you" and that there was no source for games played or
last-seen. Both are now answerable for anybody. The last-seen line in particular
is the whole point of looking up somebody who is offline.

That last row matters structurally: a by-name page hands us the numeric ID, so
one fetch gets both the profile and the key to §4.

---

## 4. Elo history

The profile links `/Charts/Ratings?RatingCategory=1&UserId=86744`. It answers
200 with the series embedded in the page:

```js
data: [{x: moment("2018-01-20"), y: 2668.47509765625},
       {x: moment("2018-01-21"), y: 2676.7861328125}, …]
```

Data, not an image — parseable with a regular expression and no chart library.
774 points for that account.

The parameters are honoured, which was checked rather than assumed: two accounts
returned different sizes and different content, and a nonexistent one returned
**HTTP 500**. Categories 0-4 all answer; 1 is the longest series and 4 had three
points, so the categories are the rating kinds and want identifying before use.

Note the asymmetry: a bad *name* on the detail page is a tidy 40-byte message, a
bad *ID* here is a 500. Treat a 500 as "no such series", not as an outage.

---

## 5. Doing this without being rude

The developers declined to provide endpoints. They did not forbid reading public
pages, and their robots.txt — the place where a site says what automated clients
may do — excludes five paths and not this one. So this is permitted. It is worth
being precise that "permitted" and "welcome" are different, and behaving like a
guest:

- **Identify the client in the User-Agent**, with a contact URL. Traffic they
  can attribute is traffic they can ask us to stop; anonymous traffic is not.
- **Cache hard and treat it as cold data.** `Cache-Control: private` means
  nothing caches these for us, so every request reaches their application
  server. A profile is worth minutes, not seconds. The elo series is worth
  longer still.
- **One fetch per profile view, on demand.** Never crawl, never prefetch the
  roster, never walk the ID space. The volume ceiling should be "what a person
  clicking around would generate", because that is what it is.
- **Never block the UI on it.** Everything in §3 is an enrichment of a card we
  can already draw from the lobby record for online players.
- **Fail quietly and say why.** If the markup moves, the panel should say the
  profile could not be read, not show blanks that look like a player with no
  awards.

If they later ask us to stop, stopping should be a config change, not a
refactor — which argues for one module and one switch.

---

## 6. Shape

**`src-tauri/src/zkweb.rs`**, beside `zkcontent.rs` and borrowing its
discipline: host allowlist (`zero-k.info` only), no redirects off-host, a size
cap, a timeout, and a refusal to interpret anything that is not HTML.

Two commands: `zkw_profile(name_or_id)` and `zkw_ratings(account_id, category)`.

**Parsing pinned by fixtures.** `zkcontent.rs` already keeps saved SOAP responses
in `src-tauri/src/fixtures/`; the same trick applies here, and it is the only
thing that makes a scraper maintainable. Save two real pages — one dense account
and one sparse one — and assert against them. When the site changes, a test
fails instead of a user seeing an empty profile.

**A miss is a value, not an error.** `Invalid account (neither an ID nor name)`
is a 40-byte answer meaning "no such player", and the UI should say that rather
than showing a failure.

**Cost:** medium. The fetching is small; the parsing is the work, and the
fixtures are what keep it honest.

---

## 7. What not to do

- **Do not scrape for online players' basics.** Name, clan, country, level,
  rank and the three Elos are already in the `User` record, free and live. The
  web page is for what the protocol will not tell us, and for people who are not
  connected.
- **Do not lowercase or "normalise" a name before looking it up.** The route is
  case-sensitive; correct the casing against the online directory instead, and
  say so when it cannot be corrected.
- **Do not treat the last ten battles as match history.** It is a recent list,
  not a record, and presenting it as a history invites the obvious next question
  we still cannot answer.
- **Do not build a crawler, a cache warmer, or a "top players" table** off the
  back of this. §5 stops being true the moment the traffic stops looking like a
  person clicking.
- **Do not put the parser in TypeScript.** It belongs behind the same allowlist
  and timeout as the rest of our outbound HTTP, which is Rust.

---

## 8. What building it changed

Three things the measurements did not show, found by writing the parser:

**Half the numbers live in tooltips, not in the text.** Level, XP to the next
level, the progress percentage and the rank's name are all inside `title`
attributes, so stripping tags to get at the text throws them away with the
markup. The parser reads both: the visible text, and the tooltips appended to
it.

**The page carries a legend of every rank icon**, to explain the scheme - so
the first `/img/ranks/*.png` on the page belongs to nobody. A player's own icon
is the one inside their rank tooltip, and that is where it is now read from.
The same tooltip states, in upstream's own words, *"Rank is represented by the
icon's color … Level is represented by the icon's shape"* - which independently
confirms what `src/net/ranks.ts` was built on.

**`nicetitle` is not a badge marker.** It is the site's tooltip attribute and it
is on everything: the login control, the clan link, the rank explainer. Reading
them all gives help text with badges mixed in. Only the images inside the badges
block are badges.

The parser's anchors were then checked against four accounts that are not
fixtures - `Stuart98`, `bread070707`, `Skel`, `Anir` - and all seven hold.
