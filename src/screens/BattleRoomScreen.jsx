import React from "react";
import { Button, Badge, Tag, PlayerRow, ChatLine, MapImage, Input,
  IconButton, Icon, UserChip } from "../ds/shiro.js";

/* Screen 4 - the largest and densest screen. Teams, spectators, bots, map,
   options, chat, ready/start. Team columns are a grid so 1v1 and 16-way FFA
   use the same layout. */
export function TeamColumn({ ally, players, max = 8, onJoin, onKick, onAddBot, onPlayer }) {
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
          onClick={onPlayer ? () => onPlayer(p.user) : undefined}
          /* Host controls are offered to everyone; the server ignores them from
             anyone else, which is the only authority that counts. The rating
             is not repeated here - UserChip already draws it, and the design
             kit's duplicate was a bug. */
          right={onKick
            ? <IconButton icon="x" size="sm" label={"Remove " + p.user.name}
                onClick={() => onKick(p.user)} />
            : null} />
      ))}
      {Array.from({ length: Math.max(0, Math.min(3, max - players.length)) }).map((_, i) => (
        <div key={"e" + i} style={{ height: "var(--row-default)", display: "flex", alignItems: "center",
          padding: "0 var(--sp-4)", boxShadow: "var(--rule-inset)" }}>
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1 var(--font-core)", color: "var(--text-faint)" }}>empty</span>
        </div>
      ))}
      <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <Button variant="quiet" size="sm" block onClick={onJoin}>Join team {ally + 1}</Button>
        {onAddBot && <Button variant="ghost" size="sm" block icon="plus"
          onClick={() => onAddBot(ally)}>Add AI</Button>}
      </div>
    </div>
  );
}

/* `chat`, `onSay`, `onTeam`, `onSpectate`, `sync` and `phase` are supplied when
   the screen is driven by the live store; without them it renders the demo
   room from data.js and the interactive parts stand down. */
export default function BattleRoomScreen({ room, onLeave, onStart, chat, onSay,
  onTeam, onSpectate, sync, phase, poll, pollOutcome, onVote, onKick, onAddBot, onPlayer }) {
  const [msg, setMsg] = React.useState("");
  const total = room.teams.reduce((n, t) => n + t.players.length, 0);
  const lines = chat || room.chat || [];
  const busy = phase ? phase.kind === "launching" || phase.kind === "running" : false;
  const send = () => { if (onSay && msg.trim()) onSay(msg); setMsg(""); };
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
          {room.teams.map(t => <TeamColumn key={t.ally} ally={t.ally} players={t.players} max={8}
            onJoin={onTeam ? () => onTeam(t.ally) : undefined}
            onKick={onKick} onAddBot={onAddBot} onPlayer={onPlayer} />)}
        </div>

        <div style={{ flex: "0 0 auto", borderTop: "1px solid var(--w-12)", display: "flex", minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: 200 }}>
            <div style={{ height: 26, display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "0 var(--sp-5)", borderBottom: "1px solid var(--w-06)" }}>
              <span className="lab">ROOM CHAT</span>
              <span className="lab">{total} PLAYERS - {room.spectators.length} SPECTATORS</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingTop: "var(--sp-2)" }}>
              {lines.map((c, i) => <ChatLine key={c.id != null ? c.id : i} {...c} />)}
            </div>
            <div style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-4) var(--sp-5)",
              borderTop: "1px solid var(--w-06)" }}>
              <Input placeholder="Message the room" value={msg} onChange={e => setMsg(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") send(); }}
                wrapStyle={{ flex: 1 }} size="sm" />
              <Button variant="quiet" size="sm" onClick={send}>Send</Button>
            </div>
          </div>
          <div style={{ width: 220, flex: "0 0 auto", borderLeft: "1px solid var(--w-06)",
            display: "flex", flexDirection: "column" }}>
            <div style={{ height: 26, display: "flex", alignItems: "center", padding: "0 var(--sp-4)",
              borderBottom: "1px solid var(--w-06)" }}><span className="lab">SPECTATORS</span></div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {room.spectators.map((s, i) => (
                <PlayerRow key={i} spectator {...s}
                  onClick={onPlayer ? () => onPlayer(s.user) : undefined} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", minHeight: 0 }}>
        <MapImage map={room.map} kind="minimap" ratio="1" caption link saturate={1} style={{ flex: "0 0 auto" }} />
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-5)",
          display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
          {poll && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <span className="lab">VOTE</span>
              <span style={{ font: "var(--text-ui)", color: "var(--text-hi)" }}>{poll.Topic}</span>
              {poll.YesNoVote ? (
                <div style={{ display: "flex", gap: "var(--sp-4)" }}>
                  <Button variant="primary" size="sm" style={{ flex: 1 }}
                    onClick={() => onVote && onVote(true)}>Yes</Button>
                  <Button variant="secondary" size="sm" style={{ flex: 1 }}
                    onClick={() => onVote && onVote(false)}>No</Button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                  {(poll.Options || []).map(o => (
                    <Button key={o.Id} variant="quiet" size="sm" block
                      onClick={() => onVote && onVote(o.Id)}>
                      {(o.DisplayName || o.Name) + "  " + o.Votes + "/" + poll.VotesToWin}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!poll && pollOutcome && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              <span className="lab">LAST VOTE</span>
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
                color: pollOutcome.Success ? "var(--text-low)" : "var(--text-faint)" }}>
                {pollOutcome.Message || pollOutcome.Topic}
              </span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <span className="lab">MOD OPTIONS</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
              {room.options.map(([k, v]) => <Tag key={k} value={v || undefined}>{k}</Tag>)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <span className="lab">SYNC</span>
            {/* What we can actually assert: whether a Zero-K install was found
                and whether it has the engine this battle runs on. Per-map
                content checks need pr-downloader - ARCHITECTURE.md section 7. */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
              <Icon name={sync && !sync.install ? "alert-triangle" : "check"} size={16}
                style={{ color: sync && !sync.install ? "var(--signal-warn)" : "var(--text-mid)" }} />
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>
                {sync
                  ? (sync.install ? "Zero-K found via " + sync.install.source : "No Zero-K installation found")
                  : "You have the map and game"}
              </span>
            </div>
            {sync && sync.engine && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                <Icon name="cpu" size={16} style={{ color: "var(--text-low)" }} />
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
                  Engine {sync.engine}
                </span>
              </div>
            )}
          </div>
        </div>
        <div style={{ padding: "var(--sp-5)", borderTop: "1px solid var(--w-12)",
          display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <Button variant="primary" size="lg" block icon="play" disabled={busy} onClick={onStart}>
            {phase && phase.kind === "launching" ? "Launching..."
              : phase && phase.kind === "running" ? "Game running"
              : room.running ? "Join game" : "Start game"}
          </Button>
          {phase && phase.kind === "failed" && (
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--signal-danger)" }}>
              {phase.reason}
            </span>
          )}
          {phase && !room.running && (
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
              Asks the host to start. Matchmaker games start on their own.
            </span>
          )}
          <div style={{ display: "flex", gap: "var(--sp-4)" }}>
            <Button variant="ghost" size="sm" style={{ flex: 1 }} onClick={onSpectate}>Spectate</Button>
            <Button variant="danger" size="sm" style={{ flex: 1 }} onClick={onLeave}>Leave</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
