# What to ask the Zero-K developers for

A draft to send, and the reasoning behind what it does and does not ask for.
`docs/PROFILE-AND-SEARCH.md` §4 has the measurements this rests on.

## Why this shape of ask

Three things make it likely to get a yes:

- **It is on a service they already run and we already use.** We call
  `ContentService.svc` today for `DownloadFile`, `FindResourceData` and
  `GetFeaturedCustomGameModes`. This is one more of the same, not a new surface.
- **One of the two DTOs already exists.** `GetPublicCommunityInfo` already
  returns `LadderItem` with `AccountID`, `Name`, `Clan`, `Country`, `Icon`,
  `IsAdmin` and `Level` - which is a player-search result. Asking for a shape
  they already serialise is a smaller ask than asking for a new one.
- **It follows their own pattern.** Operations are
  `async Task<Response> Process(Request r)` in
  `Zero-K.info/AppCode/ContentServiceImplementation.cs`, and that file already
  wraps expensive queries in `MemCache.GetCached(key, factory, seconds)`.

And two things that make it easy to refuse the *right* part: we ask whether we
have missed something first, and we say plainly that if per-player history is
considered private, we will drop that half rather than argue.

## Do not lead with scraping

It is true that we could authenticate as the user and parse the HTML, and it is
tempting to mention it as motivation. Say it once, as the thing we would rather
not do, and never as leverage. From their side an unannounced scraper is
unpredictable load on pages they cannot change freely, and nobody responds well
to being told what will happen if they say no.

## Where to send it

An issue on `ZeroK-RTS/Zero-K-Infrastructure` - that is where
`ContentServiceImplementation.cs` lives, so it lands in front of whoever would
implement it. Worth a line in their Discord too, pointing at the issue, since
that is where the maintainers actually talk.

---

## The message

> **Subject: two possible ContentService additions for a third-party lobby client**
>
> Hi - I'm building Shiro, an alternative Zero-K lobby client. It plays through
> an existing Zero-K installation and talks to ZkLobbyServer with the normal
> protocol.
>
> It already uses `ContentService.svc` for `DownloadFile`, `FindResourceData`
> and `GetFeaturedCustomGameModes`, which have worked well - thank you for
> having them public.
>
> **First, a question rather than a request:** is there an existing endpoint for
> either of the two below that I have missed? I probed the service and the site
> before writing this and did not find one, but I would rather be told I was
> looking in the wrong place than have you write something that exists.
>
> **1. Finding a player who is not currently online.**
>
> The lobby protocol has no search command, and the client only knows about
> people who are connected right now, so searching for anyone offline is not
> possible. Something shaped like the existing `FindResourceData`:
>
> ```
> FindAccount(words: string[], max: int) -> LadderItem[]
> ```
>
> `LadderItem` is already what `GetPublicCommunityInfo` returns, and its fields
> are exactly what a search result needs. No new DTO required as far as I can
> tell.
>
> **2. A player's recent matches.**
>
> This is the one I am less sure is appropriate, so please just say if it is
> not. One operation would cover both a match list and a rating graph:
>
> ```
> GetAccountBattles(accountID: int, count: int)
>   -> { SpringBattleID, StartTime, Map, Mode, Won, DurationSeconds,
>        EloChange, NewElo }[]
> ```
>
> The rating history is derivable from `NewElo` over `StartTime`, so I am not
> asking for a separate series endpoint.
>
> **On load and on privacy.** I would cache both aggressively client-side and
> send an identifying `User-Agent`, and I am happy with whatever rate limit or
> `count` cap you want to impose - `MemCache.GetCached` in
> `ContentServiceImplementation.cs` looks like the natural place if it is worth
> caching server-side too. I am only asking for what a player's page already
> shows; if you consider per-account match history private, I will drop that
> half and keep linking out to the site instead, which is what the client does
> today.
>
> I am not asking for anything authenticated, anything that writes, or anything
> not already visible on the website.
>
> I would rather ask than scrape the site, which would be worse for you than a
> documented endpoint - unpredictable load, and it breaks whenever you change a
> page. Happy to write the implementation and send a PR if that helps; happy to
> be told no.
>
> Thanks either way.

---

## If they say no, or do not answer

The profile screen already links out to zero-k.info, which reaches the real data
in one click using the player's own session, with Shiro holding and parsing
nothing. That is a legitimate end state, not a placeholder - and it is the
reason there is no rush here.
