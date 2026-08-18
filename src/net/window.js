/* Native window controls. The design draws its own titlebar
   (tauri.conf.json sets decorations:false), so these have to be wired by hand. */
import { inTauri } from "./connection";

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function minimize() { if (inTauri()) (await win()).minimize(); }
export async function toggleMaximize() { if (inTauri()) (await win()).toggleMaximize(); }
export async function close() { if (inTauri()) (await win()).close(); }
