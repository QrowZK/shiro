import React from "react";
import { Button, Meter, UserChip, EmptyState, Input, IconButton } from "../ds/shiro.js";

/* Screen 6 - matchmaker queue. The ready-check itself is a Dialog rendered by
   App as a shell overlay, because it can interrupt any screen.

   With no `queues` prop this renders the demo set from the click-through. */
export const QUEUES = [
  { id: "1v1", label: "1v1", waiting: 6, avg: "0:48" },
  { id: "teams", label: "Teams", waiting: 21, avg: "1:12" },
  { id: "coop", label: "Coop vs AI", waiting: 3, avg: "2:30" }
];

/** mm:ss since an ISO-8601 instant. */
function elapsed(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

export default function QueueScreen({ queued, onQueue, onFake, queues, joined, elo,
  joinedTime, bannedSeconds, party, onInvite, onLeaveParty }) {
  const live = Boolean(queues);
  const list = queues || QUEUES;
  const [picked, setPicked] = React.useState(live ? [] : ["teams"]);
  const [now, setNow] = React.useState(() => Date.now());

  /* Follow the server: it is the authority on which queues we are in, and a
     party member can put us in one without us clicking anything. */
  React.useEffect(() => { if (live && joined) setPicked(joined); }, [live, joined]);

  const inQueue = live ? (joined || []).length > 0 : queued;
  React.useEffect(() => {
    if (!inQueue) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [inQueue]);

  const [inviting, setInviting] = React.useState("");
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const invite = () => {
    const name = inviting.trim();
    if (!name || !onInvite) return;
    onInvite(name);
    setInviting("");
  };
  const waited = elapsed(joinedTime, now);

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ height: 26, display: "flex", alignItems: "center", padding: "0 var(--sp-5)",
          borderBottom: "1px solid var(--w-12)" }}><span className="lab">QUEUES</span></div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {list.length === 0
            ? <EmptyState icon="target" title="The server has not offered any queues."
                body="MatchMakerSetup arrives shortly after login." />
            : list.map(q => {
              const on = picked.includes(q.id);
              return (
                <div key={q.id} onClick={() => toggle(q.id)}
                  style={{ position: "relative", height: "var(--row-tall)", display: "flex", alignItems: "center",
                    gap: "var(--sp-5)", padding: "0 var(--sp-5)", cursor: "pointer",
                    background: on ? "var(--surface-selected)" : "transparent", boxShadow: "var(--rule-inset)" }}>
                  {/* Same ink as the picked row's label below, so it follows a skin. */}
                  {on && <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: "var(--text-hi)" }} />}
                  <span style={{ font: "var(--text-heading)", color: on ? "var(--text-hi)" : "var(--text-body)",
                    flex: 1 }}>{q.label}</span>
                  <span className="lab">WAITING</span>
                  <span style={{ width: 34, textAlign: "right", font: "var(--w-medium) var(--size-small)/1 var(--font-mono)",
                    color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>{q.waiting}</span>
                  <span className="lab">{q.avg != null ? "AVG WAIT" : "IN GAME"}</span>
                  <span style={{ width: 48, textAlign: "right", font: "var(--w-medium) var(--size-small)/1 var(--font-mono)",
                    color: "var(--text-mid)", fontVariantNumeric: "tabular-nums" }}>{q.avg != null ? q.avg : q.ingame}</span>
                </div>
              );
            })}
        </div>
      </div>
      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", gap: "var(--sp-6)", padding: "var(--sp-6)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <span className="lab">YOUR MATCHMAKER RATING</span>
          <span style={{ font: "var(--text-num-lg)", color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>
            {elo != null ? elo : 1766}
          </span>
        </div>
        {bannedSeconds ? (
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--signal-danger)" }}>
            Banned from the matchmaker for another {bannedSeconds}s.
          </span>
        ) : null}
        {inQueue ? (
          <>
            <Meter indeterminate label={waited ? "Searching - " + waited : "Searching"}
              right={picked.join(" / ")} />
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
              You can keep browsing battles while you wait. Shiro will interrupt when a match is found.
            </span>
            <Button variant="secondary" block onClick={() => onQueue(false, [])}>Leave queue</Button>
            {onFake && <Button variant="ghost" size="sm" block onClick={onFake}>Simulate match found</Button>}
          </>
        ) : (
          <>
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
              Pick one or more queues. {picked.length ? picked.length + " selected." : "None selected."}
            </span>
            <Button variant="primary" size="lg" block disabled={!picked.length}
              onClick={() => onQueue(true, picked)}>Join queue</Button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="lab">PARTY</span>
            {onLeaveParty && party && party.length > 0 && (
              <IconButton icon="log-out" size="sm" label="Leave party" onClick={onLeaveParty} />
            )}
          </div>
          {party && party.length > 0
            ? party.map(p => <UserChip key={p.name} {...p} size="sm" />)
            : null}
          {onInvite && (
            <div style={{ display: "flex", gap: "var(--sp-3)" }}>
              <Input placeholder="Invite by name" size="sm" value={inviting} wrapStyle={{ flex: 1 }}
                onChange={e => setInviting(e.target.value)}
                onKeyDown={e => e.key === "Enter" && invite()} />
              <Button variant="quiet" size="sm" onClick={invite}>Invite</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
