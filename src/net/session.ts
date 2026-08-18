/**
 * Session lifecycle: wire the relay to the store, run the login handshake,
 * batch the inbound flood.
 */
import {
  connect, disconnect, onLine, onStatus, passwordHash, sendLine, LIVE,
} from "./connection";
import { parseLine, serialize } from "../protocol/wire";
import type { CommandName, Message, MessageMap } from "../protocol/registry";
import { useLobby } from "../store/lobby";
import { fanout } from "../store/slices";

export const LOBBY_VERSION = "NewLobby/Shiro 0.1.0";

let unlisten: Array<() => void> = [];
let queue: Message[] = [];
let frame = 0;

/** Coalesce inbound messages into one store write per animation frame. */
function enqueue(m: Message) {
  queue.push(m);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const batch = queue;
    queue = [];
    useLobby.getState().applyBatch(batch);
    fanout(batch);
  });
}

/**
 * Send any protocol command. Typed against the generated registry, so a wrong
 * field name or a missing required field is a compile error.
 *
 *   send("JoinChannel", { ChannelName: "zk" });
 */
export function send<K extends CommandName>(cmd: K, data: MessageMap[K]): Promise<void> {
  return sendLine(serialize(cmd, data));
}

export interface Credentials {
  name: string;
  password: string;
}

/**
 * Connect and log in. Resolves once the server has accepted or rejected the
 * login; the caller reads the outcome from the store's connection state.
 *
 * Never auto-retries a rejected login: LoginChecker.LogIpFailure() fires on a
 * bad name and repeated failures earn BannedTooManyConnectionAttempts.
 */
export async function login(
  creds: Credentials,
  host: string = LIVE.host,
  port: number = LIVE.port,
): Promise<void> {
  await teardown();

  const store = useLobby.getState();
  store.reset();

  const hash = await passwordHash(creds.password);

  const settled = new Promise<void>(resolve => {
    const stop = useLobby.subscribe(s => {
      const k = s.connection.kind;
      if (k === "online" || k === "rejected" || k === "disconnected") {
        stop();
        resolve();
      }
    });
  });

  unlisten.push(await onStatus(s => useLobby.getState().applyRelayStatus(s)));
  unlisten.push(await onLine(line => {
    const m = parseLine(line);
    if (!m) return;

    // The server sends Welcome unprompted on connect; that is our cue to log in.
    if (m.cmd === "Welcome") {
      useLobby.getState().setConnection({ kind: "loggingIn" });
      void sendLine(serialize("Login", {
        Name: creds.name,
        PasswordHash: hash,
        UserID: 0,
        InstallID: "",
        ClientType: 1,
        LobbyVersion: LOBBY_VERSION,
      } as never));
    }
    enqueue(m);
  }));

  await connect(host, port);
  await settled;
}

export async function teardown(): Promise<void> {
  for (const fn of unlisten) fn();
  unlisten = [];
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  queue = [];
  await disconnect().catch(() => {});
}

export function say(text: string, place: number, target?: string): Promise<void> {
  return sendLine(serialize("Say", {
    Place: place, Target: target, Text: text, IsEmote: false, Ring: false, AllowRelay: true,
  } as never));
}
