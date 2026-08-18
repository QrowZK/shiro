import React from "react";
import { Button, Meter, Badge, EmptyState, IconButton } from "../ds/shiro.js";

/* Screen 10. P2 in the handoff and never designed, so this is built from the
   same primitives as SettingsScreen rather than from a comp.

   Downloads mostly happen on the way into a match, where the launch dialog
   already shows them. This screen exists for the rest: what is queued behind
   the current one, what failed and why, and the honest note about content this
   route cannot reach at all. */

const STATE_LABEL = {
  queued: "Waiting",
  running: "Downloading",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

function JobRow({ job, onCancel }) {
  const busy = job.state === "queued" || job.state === "running";
  const what = job.items.map(i => i.name).join(", ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)",
      padding: "var(--sp-6) var(--sp-8)", borderBottom: "1px solid var(--w-06)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-5)" }}>
        <span style={{ flex: 1, minWidth: 0, font: "var(--text-ui)", color: "var(--text-hi)",
          overflowWrap: "anywhere" }}>{what}</span>
        <Badge tone={job.state === "failed" ? "danger" : "outline"}>
          {STATE_LABEL[job.state] || job.state}
        </Badge>
        {busy && onCancel && (
          <IconButton icon="x" size="sm" label="Cancel" onClick={() => onCancel(job.id)} />
        )}
      </div>

      {job.state === "running" && (
        <Meter value={job.percent} max={100} right={job.percent + "%"} />
      )}

      {job.reason && (
        <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
          color: "var(--signal-danger)" }}>{job.reason}</span>
      )}

      {/* The stderr tail is a bug-report artefact, not something to read. */}
      {job.log && (
        <details>
          <summary style={{ cursor: "pointer", font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
            color: "var(--text-low)" }}>Downloader output</summary>
          <pre style={{ margin: "var(--sp-4) 0 0", maxHeight: 200, overflow: "auto",
            font: "var(--w-regular) var(--size-micro)/1.5 var(--font-mono)",
            color: "var(--text-low)", background: "var(--surface-sunken)",
            padding: "var(--sp-4)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {job.log}
          </pre>
        </details>
      )}
    </div>
  );
}

export default function DownloadsScreen({ jobs, order, onCancel, onClear, onSettings }) {
  const list = (order || []).map(id => jobs[id]).filter(Boolean);
  const finished = list.filter(j => !["queued", "running"].includes(j.state)).length;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ maxWidth: 720 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)",
          padding: "var(--sp-7) var(--sp-8)", borderBottom: "1px solid var(--w-06)" }}>
          <span className="lab" style={{ flex: 1 }}>DOWNLOADS</span>
          {finished > 0 && onClear && (
            <Button variant="quiet" size="sm" onClick={onClear}>Clear finished</Button>
          )}
        </div>

        {list.length === 0 ? (
          <div style={{ padding: "var(--sp-8)" }}>
            <EmptyState icon="download" title="Nothing downloading."
              body="Shiro fetches the game and map on the way into a match, so this
                    usually stays empty. Anything queued behind a running download,
                    or anything that failed, shows up here." />
          </div>
        ) : (
          list.map(j => <JobRow key={j.id} job={j} onCancel={onCancel} />)
        )}

        {/* Being straight about this beats a mystery failure later: custom games
            are distributed through a route pr-downloader cannot reach. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)",
          padding: "var(--sp-7) var(--sp-8)" }}>
          <span className="lab">WHAT THIS CAN AND CANNOT GET</span>
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
            color: "var(--text-low)" }}>
            Zero-K itself and ordinary maps download fine. Custom games such as
            Supreme-K or Zero Wars, and their maps, are distributed separately and
            cannot be fetched this way — run the official lobby once for those.
          </span>
          {onSettings && (
            <div>
              <Button variant="ghost" size="sm" onClick={onSettings}>
                Zero-K installation settings
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
