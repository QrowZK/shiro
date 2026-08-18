import React from "react";
import { Button, Badge, Tag, PlayerRow, ChatLine, MapImage, Input,
  IconButton, Icon, UserChip } from "../ds/shiro.js";

/* Screen 4 - the largest and densest screen. Teams, spectators, bots, map,
   options, chat, ready/start. Team columns are a grid so 1v1 and 16-way FFA
   use the same layout. */
export function TeamColumn({ ally, players, max = 8 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0,
      borderRight: "1px solid var(--w-06)" }}>
      <div style={{ height: 26, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 var(--sp-4)", borderBottom: "1px solid var(--w-06)", background: "var(--w-04)" }}>
        <span className="lab">TEAM {ally + 1}</span>
        <span style={{ font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)", color: "var(--text-low)",
          fontVariantNumeric: "tabular-nums" }}>{players.length}/{max}</span>
      </div>
      {players.map((p, i) => (
        <PlayerRow key={i} {...p} user={p.user}
          right={<span style={{ font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
            color: "var(--text-low)", fontVariantNumeric: "tabular-nums" }}>{p.user.elo || ""}</span>} />
      ))}
      {Array.from({ length: Math.max(0, Math.min(3, max - players.length)) }).map((_, i) => (
        <div key={"e" + i} style={{ height: "var(--row-default)", display: "flex", alignItems: "center",
          padding: "0 var(--sp-4)", boxShadow: "var(--rule-inset)" }}>
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1 var(--font-core)", color: "var(--text-faint)" }}>empty</span>
        </div>
      ))}
      <div style={{ padding: "var(--sp-4)" }}>
        <Button variant="quiet" size="sm" block>Join team {ally + 1}</Button>
      </div>
    </div>
  );
}

export default function BattleRoomScreen({ room, onLeave, onStart }) {
  const [ready, setReady] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const total = room.teams.reduce((n, t) => n + t.players.length, 0);
  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div style={{ height: 44, flex: "0 0 auto", display: "flex", alignItems: "center", gap: "var(--sp-5)",
          padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
          <IconButton icon="arrow-left" label="Back to battles" onClick={onLeave} />
          <span style={{ font: "var(--w-semibold) var(--size-mid)/1 var(--font-core)", color: "var(--text-hi)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{room.title}</span>
          <Badge tone="outline">{room.mode}</Badge>
          <span style={{ flex: 1 }} />
          <span className="lab">HOST</span>
          <UserChip name={room.founder} size="sm" presence="room" />
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "grid",
          gridTemplateColumns: "repeat(" + room.teams.length + ", minmax(0,1fr))", overflowY: "auto" }}>
          {room.teams.map(t => <TeamColumn key={t.ally} ally={t.ally} players={t.players} max={8} />)}
        </div>

        <div style={{ flex: "0 0 auto", borderTop: "1px solid var(--w-12)", display: "flex", minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: 200 }}>
            <div style={{ height: 26, display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-06)" }}>
              <span className="lab">ROOM CHAT</span>
              <span className="lab">{total} PLAYERS - {room.spectators.length} SPECTATORS</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingTop: "var(--sp-2)" }}>
              {room.chat.map((c, i) => <ChatLine key={i} {...c} />)}
            </div>
            <div style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-4) var(--sp-5)",
              borderTop: "1px solid var(--w-06)" }}>
              <Input placeholder="Message the room" value={msg} onChange={e => setMsg(e.target.value)}
                wrapStyle={{ flex: 1 }} size="sm" />
              <Button variant="quiet" size="sm" onClick={() => setMsg("")}>Send</Button>
            </div>
          </div>
          <div style={{ width: 220, flex: "0 0 auto", borderLeft: "1px solid var(--w-06)",
            display: "flex", flexDirection: "column" }}>
            <div style={{ height: 26, display: "flex", alignItems: "center", padding: "0 var(--sp-4)",
              borderBottom: "1px solid var(--w-06)" }}><span className="lab">SPECTATORS</span></div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {room.spectators.map((s, i) => <PlayerRow key={i} spectator {...s} />)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", minHeight: 0 }}>
        <MapImage map={room.map} kind="minimap" ratio="1" caption link saturate={1} style={{ flex: "0 0 auto" }} />
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-5)",
          display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <span className="lab">MOD OPTIONS</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
              {room.options.map(([k, v]) => <Tag key={k} value={v || undefined}>{k}</Tag>)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <span className="lab">SYNC</span>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
              <Icon name="check" size={16} style={{ color: "var(--text-mid)" }} />
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>You have the map and game</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
              <Icon name="download" size={16} style={{ color: "var(--text-low)" }} />
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
                1 player is still downloading
              </span>
            </div>
          </div>
        </div>
        <div style={{ padding: "var(--sp-5)", borderTop: "1px solid var(--w-12)",
          display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <Button variant={ready ? "secondary" : "primary"} size="lg" block icon={ready ? "check" : undefined}
            onClick={() => setReady(!ready)}>{ready ? "Ready" : "Ready up"}</Button>
          <Button variant="primary" size="lg" block icon="play" disabled={!ready} onClick={onStart}>Start</Button>
          <div style={{ display: "flex", gap: "var(--sp-4)" }}>
            <Button variant="ghost" size="sm" style={{ flex: 1 }}>Spectate</Button>
            <Button variant="danger" size="sm" style={{ flex: 1 }} onClick={onLeave}>Leave</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
