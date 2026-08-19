import React from "react";
import { Badge, Button, Input, UserChip, EmptyState } from "../ds/shiro.js";

/* Design 2A: one column, and searching turns the whole screen into whoever you
   picked. There is no separate "someone else" layout - the same panels render
   with less in them.
 *
 * Which panels those are is decided by the protocol, not by taste:
 *
 *   - Your own profile arrives unprompted (`UserProfile`) and carries the three
 *     ratings, level, rank, badges, kudos and awards.
 *   - Everyone else's comes from their `User` record, which the server
 *     broadcasts for anyone online: name, clan, country, faction, level, rank
 *     and two of the three ratings.
 *   - You cannot ask for someone else's profile. `UserProfile` is
 *     server-to-client only and sending it throws on the real server, which is
 *     why store/friends.ts requestProfile is a no-op.
 *
 * So a panel with no data for the person on screen is left out rather than
 * drawn empty - a player with no Planetwars rating and a player whose rating we
 * cannot see look identical otherwise, and only one of those is true.
 * docs/PROFILE-AND-SEARCH.md has the full accounting. */

const COUNTRIES = {
  DE: "Germany", US: "United States", GB: "United Kingdom", FR: "France",
  PL: "Poland", SE: "Sweden", NL: "Netherlands", CA: "Canada", JP: "Japan",
  BR: "Brazil", AU: "Australia", RU: "Russia", ES: "Spain", IT: "Italy",
  FI: "Finland", NO: "Norway", DK: "Denmark", CZ: "Czechia", AT: "Austria",
};

const FACTIONS = {
  machines: "Free Machines", hegemony: "Dynasty Hegemony", rising: "Empire Rising",
};

/* The nine ids the server sends, from Chobby's own table. An id we do not know
   shows as itself - the list grows server-side, not here. */
const BADGE_LABELS = {
  player_level: "Level 200", player_elo: "Top 3 player",
  donator_0: "Bronze donator", donator_1: "Silver donator",
  donator_2: "Gold donator", donator_3: "Diamond donator",
  dev_content: "External developer", dev_game: "Game developer",
  dev_adv: "Lead developer",
};

const label = { font: "var(--text-label)", letterSpacing: "var(--track-label)",
  textTransform: "uppercase", color: "var(--text-low)", whiteSpace: "nowrap" };

/** A search hit's presence, in the same words the friends list uses. */
function presenceOf(u) {
  if (!u) return "OFFLINE";
  if (u.InGameSince) return "IN GAME";
  if (u.BattleID != null) return "IN ROOM";
  if (u.AwaySince) return "AWAY";
  return "ONLINE";
}

/* Rank by how well the query matches, then alphabetically. A bare substring
   match over every connected player returns half the directory for two
   letters, so a prefix has to beat a mid-word hit. */
function rankHits(users, query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored = [];
  for (const u of Object.values(users)) {
    const name = (u.Name || "").toLowerCase();
    const clan = (u.Clan || "").toLowerCase();
    const country = (u.Country || "").toLowerCase();
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (clan === q || country === q) score = 2;
    else if (name.includes(q)) score = 3;
    else if (clan.includes(q)) score = 4;
    if (score >= 0) scored.push([score, u]);
  }
  scored.sort((a, b) => a[0] - b[0] || (a[1].Name || "").localeCompare(b[1].Name || ""));
  return scored.slice(0, 8).map(s => s[1]);
}

function Rating({ name, value }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: "var(--sp-6) var(--sp-7)",
      borderRight: "1px solid var(--w-06)" }}>
      <span style={label}>{name}</span>
      <div style={{ marginTop: "var(--sp-3)" }}>
        <span style={{ font: "var(--text-num-lg)", color: "var(--text-hi)",
          fontVariantNumeric: "tabular-nums" }}>
          {value != null ? Math.round(value) : "-"}
        </span>
      </div>
    </div>
  );
}

/** The elo line, drawn from matches this client actually saw. */
function EloTrend({ points }) {
  if (points.length < 2) return null;
  const W = 640, H = 96;
  const lo = Math.min(...points), hi = Math.max(...points);
  const span = hi - lo || 1;
  const x = i => (i / (points.length - 1)) * W;
  const y = v => H - ((v - lo) / span) * (H - 12) - 6;
  const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <div style={{ padding: "var(--sp-6) var(--sp-7)", borderTop: "1px solid var(--w-06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        {/* Not "last 30 days": this is the matches this client has seen, which
            is all the protocol gives us. Saying otherwise would be a lie the
            axis cannot back up. */}
        <span style={label}>General elo &middot; matches seen this session</span>
        <span style={{ font: "var(--text-ui-sm)", color: "var(--text-mid)",
          fontVariantNumeric: "tabular-nums" }}>
          {Math.round(points[0])} &minus; {Math.round(points[points.length - 1])}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true"
        style={{ marginTop: "var(--sp-4)", display: "block" }}>
        <path d={`${line}L${W},${H}L0,${H}Z`} fill="var(--w-04)" />
        <path d={line} fill="none" stroke="var(--text-hi)" strokeWidth="1.5"
          vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export default function ProfileScreen({ me, users = {}, profile, records = [], viewing,
  onView, onMessage, onAddFriend, onIgnore, onExternal, matchRows = [] }) {
  const [query, setQuery] = React.useState("");
  const hits = React.useMemo(() => rankHits(users, query), [users, query]);

  const isMe = !viewing || viewing === me;
  const name = isMe ? me : viewing;
  const u = users[name];

  /* Yours comes from UserProfile, theirs from the directory. Both may be
     missing pieces; nothing here invents one. */
  const level = isMe ? (profile?.Level ?? u?.Level) : u?.Level;
  const rank = isMe ? (profile?.Rank ?? u?.Rank) : u?.Rank;
  const badges = (isMe ? profile?.Badges : u?.Badges) || [];
  const ratings = isMe
    ? [["General elo", profile?.EffectiveElo ?? u?.EffectiveElo],
      ["Matchmaker", profile?.EffectiveMmElo ?? u?.EffectiveMmElo],
      ["Planetwars", profile?.EffectivePwElo]]
    // No Planetwars rating in a User record, so it is not offered at all.
    : [["General elo", u?.EffectiveElo], ["Matchmaker", u?.EffectiveMmElo]];

  const trend = React.useMemo(
    () => (isMe ? records.map(r => r.elo).filter(n => typeof n === "number").reverse() : []),
    [isMe, records],
  );

  const open = who => { setQuery(""); if (onView) onView(who === me ? undefined : who); };

  const meta = [
    u?.Country && `${u.Country}${COUNTRIES[u.Country] ? " · " + COUNTRIES[u.Country] : ""}`,
    u?.Faction && (FACTIONS[u.Faction.toLowerCase()] || u.Faction),
    rank != null && `Rank ${rank}`,
  ].filter(Boolean);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      {/* Header: where you are, and the way to go somewhere else. */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)",
        padding: "var(--sp-5) var(--sp-7)", borderBottom: "1px solid var(--w-06)" }}>
        {isMe ? <span style={label}>My profile</span> : (
          <>
            <Button variant="ghost" size="sm" icon="arrow-left"
              onClick={() => open(me)}>My profile</Button>
            <span style={label}>Viewing</span>
            <span style={{ font: "var(--text-ui)", color: "var(--text-hi)" }}>{name}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <div style={{ position: "relative", width: 260 }}>
          <Input size="sm" placeholder="Find a player" value={query} icon="search"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && hits[0]) open(hits[0].Name); }} />
          {hits.length > 0 && (
            <div style={{ position: "absolute", top: "100%", right: 0, left: 0, zIndex: 40,
              marginTop: 4, background: "var(--surface-panel)",
              border: "1px solid var(--w-12)", boxShadow: "var(--elev-menu)" }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                padding: "var(--sp-3) var(--sp-4)", borderBottom: "1px solid var(--w-06)" }}>
                <span style={label}>{hits.length} online</span>
                <span style={label}>Enter opens top hit</span>
              </div>
              {hits.map(h => (
                <div key={h.Name} onClick={() => open(h.Name)}
                  style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)",
                    padding: "var(--sp-3) var(--sp-4)", cursor: "pointer",
                    boxShadow: "var(--rule-inset)" }}>
                  <UserChip name={h.Name} clan={h.Clan} country={h.Country}
                    level={h.Level} style={{ flex: 1, minWidth: 0 }} />
                  <span style={label}>{presenceOf(h)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!name ? <EmptyState icon="user" title="Not logged in." /> : (
        <>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-5)",
            padding: "var(--sp-7)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)" }}>
                <span style={{ font: "var(--w-bold) var(--size-2xl)/1 var(--font-core)",
                  color: "var(--text-hi)" }}>{name}</span>
                {u?.Clan && <span style={{ font: "var(--text-heading)",
                  color: "var(--text-low)" }}>[{u.Clan}]</span>}
                {u?.InGameSince && <Badge tone="outline">In game</Badge>}
                {u?.IsBot && <Badge tone="outline">Bot</Badge>}
                {u?.IsAdmin && <Badge tone="solid">Admin</Badge>}
              </div>
              {meta.length > 0 && (
                <div style={{ display: "flex", gap: "var(--sp-6)", marginTop: "var(--sp-4)" }}>
                  {meta.map(m => <span key={m} style={label}>{m}</span>)}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              {!isMe && onAddFriend && (
                <Button variant="secondary" size="sm" icon="user-plus"
                  onClick={() => onAddFriend(name)}>Add friend</Button>
              )}
              {!isMe && onMessage && (
                <Button variant="ghost" size="sm" icon="message-square"
                  onClick={() => onMessage(name)}>Message</Button>
              )}
              {onExternal && (
                <Button variant="ghost" size="sm" icon="external-link"
                  onClick={() => onExternal(name)}>zero-k.info</Button>
              )}
              {!isMe && onIgnore && (
                <Button variant="ghost" size="sm" onClick={() => onIgnore(name)}>Ignore</Button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", borderTop: "1px solid var(--w-06)",
            borderBottom: "1px solid var(--w-06)" }}>
            {ratings.map(([n, v]) => <Rating key={n} name={n} value={v} />)}
            <div style={{ width: 220, padding: "var(--sp-6) var(--sp-7)",
              display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                {level != null && <Badge tone="outline">Level {level}</Badge>}
                {rank != null && <Badge tone="outline">Rank {rank}</Badge>}
              </div>
              {badges.length > 0 && (
                <>
                  <span style={label}>Badges</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
                    {badges.map(b => (
                      <Badge key={b} tone="outline">{BADGE_LABELS[b] || b}</Badge>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <EloTrend points={trend} />

          {isMe && matchRows.length > 0 && (
            <div>
              <div style={{ display: "grid",
                gridTemplateColumns: "1fr 90px 90px 80px 90px", gap: "var(--sp-5)",
                padding: "var(--sp-4) var(--sp-7)", borderBottom: "1px solid var(--w-06)" }}>
                {["Map", "Result", "Mode", "Length", "Elo"].map(h =>
                  <span key={h} style={label}>{h}</span>)}
              </div>
              {matchRows.map(m => (
                <div key={m.id} style={{ display: "grid",
                  gridTemplateColumns: "1fr 90px 90px 80px 90px", gap: "var(--sp-5)",
                  alignItems: "center", padding: "var(--sp-4) var(--sp-7)",
                  boxShadow: "var(--rule-inset)" }}>
                  <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                    color: "var(--text-body)", overflowWrap: "anywhere" }}>{m.map || "-"}</span>
                  <span style={{ font: "var(--text-ui-sm)", color: "var(--text-hi)" }}>{m.result}</span>
                  <span style={label}>{m.mode || "-"}</span>
                  <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                    color: "var(--text-low)" }}>{m.elapsed || "-"}</span>
                  <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                    color: m.change > 0 ? "var(--signal-ok)" : "var(--text-low)",
                    fontVariantNumeric: "tabular-nums" }}>
                    {m.change == null ? "-" : (m.change > 0 ? "+" : "") + Math.round(m.change)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* The protocol has no match history, so this fills as you play
              rather than arriving populated. Saying that beats a blank half a
              screen tall. */}
          {isMe && matchRows.length === 0 && (
            <div style={{ padding: "var(--sp-8)" }}>
              <EmptyState icon="trophy" title="No matches yet."
                body="Games you play while Shiro is open are listed here." />
            </div>
          )}

          {/* Deliberately absent rather than empty: games played, win rate,
              hours and best elo are in the design but in no message the server
              sends. See docs/PROFILE-AND-SEARCH.md. */}
          {!isMe && (
            <div style={{ padding: "var(--sp-6) var(--sp-7)" }}>
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
                color: "var(--text-faint)" }}>
                Match history and progression are only available for your own account.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
