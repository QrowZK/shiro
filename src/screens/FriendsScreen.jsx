import React from "react";
import { Button, UserChip, IconButton, Badge, Input, EmptyState } from "../ds/shiro.js";
import magpie from "../assets/art/magpie-banking.png";

/* Screen 8 - friends list and the profile detail: badges, level, three ratings.

   Live, the list is whatever the server sent in `FriendList`; the ratings come
   from `UserProfile`, which is requested when a row is selected. With no
   handlers it renders the demo roster from data.js. */
export default function FriendsScreen({ users, profile, onSelect, onMessage, onIgnore,
  onAdd, onRemove }) {
  const [sel, setSel] = React.useState(null);
  const [adding, setAdding] = React.useState("");

  /* Keep the selection valid as people come and go: a friend who logs off is
     still in the list, but one you removed is not. */
  const current = users.find(x => x.name === sel) || users[0];
  React.useEffect(() => {
    if (current && current.name !== sel) setSel(current.name);
    if (current && onSelect) onSelect(current.name);
  }, [current && current.name]);

  const pick = name => { setSel(name); if (onSelect) onSelect(name); };
  const submitAdd = () => {
    const name = adding.trim();
    if (!name || !onAdd) return;
    onAdd(name);
    setAdding("");
  };

  const u = current;
  /* The demo data has one rating and the design shows three, so it derives the
     other two. Live, all three are real - `UserProfile` carries them. */
  const ratings = profile
    ? [["GENERAL ELO", profile.elo], ["MATCHMAKER", profile.mmElo], ["PLANETWARS", profile.pwElo]]
    : u
      ? [["GENERAL ELO", u.elo], ["MATCHMAKER", u.elo ? u.elo - 76 : null], ["1V1", u.elo ? u.elo + 34 : null]]
      : [];

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", minHeight: 0 }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* A Magpie banking away behind the roster, filling the dead space a
            friends list leaves: the band between a name and its presence
            label, and the block under the last row.

            Three things about the placement are deliberate. It lives in the
            column rather than inside the scroller, so it stays put while the
            list scrolls over it. It is clipped to the column, so the bleed off
            the bottom edge stays inside the panel instead of running under the
            status bar. And it stops short of the right-hand column the
            presence labels sit in - the wing crosses the rows, never the text.

            It is dropped entirely when there is nobody to list: art behind an
            empty state reads as a mistake rather than a flourish.

            Rendered from the game's own bomberstrike.s3o. The ink is black, so
            a dark skin has to invert it; --art-filter is that hook. */}
        {users.length > 0 && (
          <div aria-hidden="true" style={{
            position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
          }}>
            <div style={{
              position: "absolute", right: 70, bottom: -30, width: 820, height: 431,
              backgroundImage: `url(${magpie})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: "contain",
              backgroundPosition: "right bottom",
              filter: "var(--art-filter, none)",
              opacity: 0.16,
            }} />
          </div>
        )}
        <div style={{ position: "relative", height: 26, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab">FRIENDS</span>
          <span className="lab">{users.length} TOTAL</span>
        </div>
        <div style={{ position: "relative", flex: 1, minHeight: 0, overflowY: "auto" }}>
          {users.length === 0
            ? <EmptyState icon="users" title="No friends yet."
                body="Add someone by name and they show up here whenever they are online." />
            : users.map(x => (
              <div key={x.name} onClick={() => pick(x.name)}
                style={{ position: "relative", height: "var(--row-tall)", display: "flex", alignItems: "center",
                  gap: "var(--sp-5)", padding: "0 var(--sp-5)", cursor: "pointer",
                  background: u && x.name === u.name ? "var(--surface-selected)" : "transparent",
                  boxShadow: "var(--rule-inset)" }}>
                {u && x.name === u.name && <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: "var(--ink-000)" }} />}
                <UserChip {...x} style={{ flex: 1, minWidth: 0 }} />
                <span className="lab">{x.presence === "ingame" ? "IN GAME" : x.presence === "room" ? "IN ROOM"
                  : x.presence === "away" ? "AWAY" : x.presence === "offline" ? "OFFLINE" : "ONLINE"}</span>
                <IconButton icon="message-square" label="Message" size="sm"
                  onClick={onMessage ? e => { e.stopPropagation(); onMessage(x.name); } : undefined} />
              </div>
            ))}
        </div>
        {onAdd && (
          <div style={{ position: "relative", display: "flex", gap: "var(--sp-3)",
            padding: "var(--sp-4) var(--sp-5)", background: "var(--surface-base)",
            borderTop: "1px solid var(--w-12)" }}>
            <Input placeholder="Add a friend by name" size="sm" value={adding} wrapStyle={{ flex: 1 }}
              onChange={e => setAdding(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitAdd()} />
            <Button variant="quiet" size="sm" onClick={submitAdd}>Add</Button>
          </div>
        )}
      </div>
      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        padding: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
        {!u ? <EmptyState icon="user" title="Nobody selected." /> : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <span className="lab">PROFILE</span>
              <UserChip {...u} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
                <Badge tone="outline">Level {(profile && profile.level) || u.level || "-"}</Badge>
                {u.admin && <Badge tone="solid">Admin</Badge>}
                {u.bot && <Badge tone="outline">Bot</Badge>}
                {profile && profile.rank != null && <Badge tone="outline">Rank {profile.rank}</Badge>}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--sp-4) var(--sp-6)" }}>
              {ratings.map(([label, value]) => (
                <React.Fragment key={label}>
                  <span className="lab">{label}</span>
                  <span style={{ font: "var(--text-num)", color: "var(--text-hi)", textAlign: "right",
                    fontVariantNumeric: "tabular-nums" }}>{value || "-"}</span>
                </React.Fragment>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <span className="lab">BADGES</span>
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-faint)" }}>
                {profile && profile.badges && profile.badges.length
                  ? profile.badges.join(", ")
                  : "Badge image assets are unresolved - engineering will supply the URL scheme for Avatar, Icon and Badges[]."}
              </span>
            </div>
            <span style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: "var(--sp-4)" }}>
              <Button variant="secondary" style={{ flex: 1 }}
                onClick={onMessage ? () => onMessage(u.name) : undefined}>Message</Button>
              <Button variant="ghost" style={{ flex: 1 }}
                onClick={onIgnore ? () => onIgnore(u.name) : undefined}>Ignore</Button>
              {onRemove && (
                <Button variant="ghost" style={{ flex: 1 }} onClick={() => onRemove(u.name)}>Remove</Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
