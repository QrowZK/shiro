import React from "react";
import { Button, UserChip, IconButton, Badge } from "../ds/shiro.js";

/* Screen 8 - friends list and the profile detail: badges, level, three ratings. */
export default function FriendsScreen({ users }) {
  const [sel, setSel] = React.useState(users[1].name);
  const u = users.find(x => x.name === sel);
  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ height: 26, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab">FRIENDS</span>
          <span className="lab">{users.length} TOTAL</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {users.map(x => (
            <div key={x.name} onClick={() => setSel(x.name)}
              style={{ position: "relative", height: "var(--row-tall)", display: "flex", alignItems: "center",
                gap: "var(--sp-5)", padding: "0 var(--sp-5)", cursor: "pointer",
                background: x.name === sel ? "var(--surface-selected)" : "transparent",
                boxShadow: "var(--rule-inset)" }}>
              {x.name === sel && <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: "var(--ink-000)" }} />}
              <UserChip {...x} style={{ flex: 1, minWidth: 0 }} />
              <span className="lab">{x.presence === "ingame" ? "IN GAME" : x.presence === "room" ? "IN ROOM" : x.presence === "away" ? "AWAY" : "ONLINE"}</span>
              <IconButton icon="message-square" label="Message" size="sm" />
            </div>
          ))}
        </div>
      </div>
      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        padding: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <span className="lab">PROFILE</span>
          <UserChip {...u} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
            <Badge tone="outline">Level {u.level}</Badge>
            {u.admin && <Badge tone="solid">Admin</Badge>}
            {u.bot && <Badge tone="outline">Bot</Badge>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--sp-4) var(--sp-6)" }}>
          <span className="lab">GENERAL ELO</span>
          <span style={{ font: "var(--text-num)", color: "var(--text-hi)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{u.elo || "-"}</span>
          <span className="lab">MATCHMAKER</span>
          <span style={{ font: "var(--text-num)", color: "var(--text-hi)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{u.elo ? u.elo - 76 : "-"}</span>
          <span className="lab">1V1</span>
          <span style={{ font: "var(--text-num)", color: "var(--text-hi)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{u.elo ? u.elo + 34 : "-"}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <span className="lab">BADGES</span>
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-faint)" }}>
            Badge image assets are unresolved - engineering will supply the URL scheme for Avatar, Icon and Badges[].
          </span>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: "var(--sp-4)" }}>
          <Button variant="secondary" style={{ flex: 1 }}>Message</Button>
          <Button variant="ghost" style={{ flex: 1 }}>Ignore</Button>
        </div>
      </div>
    </div>
  );
}
