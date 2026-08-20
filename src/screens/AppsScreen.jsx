import React from "react";
import { Button, Badge, EmptyState } from "../ds/shiro.js";

/* The app launcher. Four entries, shipped with Shiro, no search and no
   accounts - see docs/APPS.md for why this is a launcher rather than a store.

   The design problem here is the states, not the list: an app can be built in,
   installed, not installed, or unavailable because there is nothing published
   yet, and the last of those has to look deliberate rather than broken. */

const label = {
  font: "var(--text-label)", letterSpacing: "var(--track-label)",
  textTransform: "uppercase", color: "var(--text-faint)",
};

/** What this row can do, worked out once so the row and the panel agree. */
export function appState(app, status) {
  if (app.unavailable) return "unavailable";
  if (app.kind === "builtin") return "builtin";
  return status?.installed ? "installed" : "available";
}

function StateBadge({ state, status }) {
  switch (state) {
    case "builtin":
      return <Badge tone="outline">Built in</Badge>;
    case "installed":
      return <Badge tone="solid">{status?.installedVersion || "Installed"}</Badge>;
    case "unavailable":
      return <Badge tone="outline">Unavailable</Badge>;
    default:
      return <Badge tone="outline">Not installed</Badge>;
  }
}

function Row({ app, status, selected, onSelect, onOpen }) {
  const state = appState(app, status);
  /* The row is a div with a button inside it, not a button containing one: a
     nested button is invalid HTML, and the browser resolves it by making the
     inner one unclickable - which is exactly the button that launches things. */
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "var(--sp-5)",
      padding: "var(--sp-5) var(--sp-6)",
      background: selected ? "var(--w-06)" : "transparent",
      boxShadow: "var(--rule-inset)",
    }}>
      <button type="button" onClick={onSelect}
        style={{ flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer",
          background: "transparent", border: 0, padding: 0, color: "inherit",
          font: "inherit", display: "flex", flexDirection: "column",
          gap: "var(--sp-2)" }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)" }}>
          <span style={{ font: "var(--w-medium) var(--size-mid)/1.2 var(--font-core)",
            color: "var(--text-hi)" }}>{app.name}</span>
          <StateBadge state={state} status={status} />
        </span>
        <span style={{ font: "var(--text-ui-sm)", color: "var(--text-mid)" }}>
          {app.summary}
        </span>
      </button>
      {(state === "builtin" || state === "installed") && (
        <Button size="sm" variant="primary" onClick={() => onOpen(app)}>
          {state === "builtin" ? "Open" : "Launch"}
        </Button>
      )}
    </div>
  );
}

export default function AppsScreen({ apps = [], statuses = [], onOpen, onLaunch, error }) {
  const [sel, setSel] = React.useState(undefined);
  const byId = React.useMemo(
    () => Object.fromEntries(statuses.map(s => [s.id, s])), [statuses]);

  const current = apps.find(a => a.id === sel) || apps[0];
  const status = current ? byId[current.id] : undefined;
  const state = current ? appState(current, status) : undefined;

  const open = app => {
    const s = byId[app.id];
    if (appState(app, s) === "builtin") onOpen?.(app.id);
    else onLaunch?.(app.id);
  };

  if (!apps.length) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <EmptyState icon="package" title="Apps need the desktop app."
          body="The launcher installs and runs programs, which a browser tab cannot do." />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px",
      minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ height: 44, flex: "0 0 auto", display: "flex", alignItems: "center",
          padding: "0 var(--sp-6)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab">APPS</span>
          <span style={{ flex: 1 }} />
          <span style={label}>{apps.length} available</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {apps.map(a => (
            <Row key={a.id} app={a} status={byId[a.id]}
              selected={current && current.id === a.id}
              onSelect={() => setSel(a.id)} onOpen={open} />
          ))}
        </div>
      </div>

      {/* Detail. Downloading and running somebody else's program is a thing a
          person should be able to look at before agreeing to it, so the source
          is on screen rather than implied. */}
      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        padding: "var(--sp-6)", display: "flex", flexDirection: "column",
        gap: "var(--sp-5)", overflowY: "auto" }}>
        {current && (
          <>
            <div>
              <span style={{ font: "var(--w-bold) var(--size-xl)/1.1 var(--font-core)",
                color: "var(--text-hi)" }}>{current.name}</span>
            </div>
            <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", lineHeight: 1.5 }}>
              {current.description}
            </span>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              <span style={label}>Source</span>
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                color: "var(--text-body)", overflowWrap: "anywhere" }}>{current.source}</span>
            </div>

            {status?.path && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                <span style={label}>Installed at</span>
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                  color: "var(--text-low)", overflowWrap: "anywhere" }}>{status.path}</span>
              </div>
            )}

            {/* Greyed with the reason, rather than a button that fails. */}
            {state === "unavailable" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <span style={label}>Not available</span>
                <span style={{ font: "var(--text-ui-sm)", color: "var(--text-mid)" }}>
                  {current.unavailable}
                </span>
              </div>
            )}

            {error && (
              <span style={{ font: "var(--text-ui-sm)", color: "var(--signal-warn)" }}>
                {error}
              </span>
            )}

            <span style={{ flex: 1 }} />
            {(state === "builtin" || state === "installed") && (
              <Button variant="primary" size="lg" onClick={() => open(current)}>
                {state === "builtin" ? "Open" : "Launch"}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
