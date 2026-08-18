/**
 * Local preferences. Nothing here comes from or goes to the server.
 *
 * Persisted to localStorage because the alternative - a file through Tauri -
 * needs a plugin and a capability for something that is three strings. It is
 * read once at module load and written on every change.
 *
 * The saved password is the only sensitive thing in here, and it is saved only
 * when "stay logged in" is ticked, which is what that box means. It is stored
 * as the plain password rather than the hash so a future protocol change to the
 * hash function does not silently lock people out; the hash is not a secret in
 * this protocol anyway - it is a password equivalent, and either form in
 * localStorage is readable by anything with access to the profile.
 */
import { create } from "zustand";

const KEY = "shiro.settings";

export interface Settings {
  /** Last account name, remembered whether or not the password is. */
  name: string;
  /** Only set when `remember` is on. */
  password?: string;
  remember: boolean;
  /** Overrides for the lobby server; empty means the live defaults. */
  host?: string;
  port?: number;
  /** Overrides install detection when someone keeps Zero-K somewhere odd. */
  installRoot?: string;
}

export interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  /** Forget the password but keep the name, which is not a secret. */
  forgetPassword: () => void;
}

const DEFAULTS: Settings = { name: "", remember: false };

function load(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    // Merged over the defaults so an older stored shape cannot leave a hole.
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: Settings): void {
  try {
    const { name, password, remember, host, port, installRoot } = s;
    globalThis.localStorage?.setItem(KEY, JSON.stringify({
      name, remember, host, port, installRoot,
      password: remember ? password : undefined,
    }));
  } catch {
    // A private-mode browser refusing storage is not worth an error dialog.
  }
}

export const useSettings = create<SettingsState>((setState, get) => ({
  ...load(),

  set: patch => {
    setState(patch);
    save(get());
  },

  forgetPassword: () => {
    setState({ password: undefined, remember: false });
    save(get());
  },
}));
