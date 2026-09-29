/**
 * Wi-Fi sync with the computer app, the phone's side. The computer is the
 * server (Android stops background servers); the phone finds it on the local
 * network, pairs once, and while both are open keeps a WebSocket to it:
 * a change on either side sends a "changed" ping and the phone syncs within
 * a second. After a disconnection, the next connection catches up.
 *
 * Merging and the protocol are the shared code in ./core (the computer runs
 * the same). Native parts: ./native (android/.../sync).
 */
import NetInfo from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import {
  DEVICE_ID,
  getSettingSync,
  notifyLibrary,
  onLocalChange,
  setSettingSync,
  syncClock,
  syncDb,
  whenDatabaseReady,
} from '../db/database';
import { syncedLanguage } from '../services/settings';
import {
  CURSOR_MARGIN_MS,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  SYNC_DEBOUNCE_MS,
  PING,
  applyChanges,
  collectChanges,
  compatibility,
  hlcMinus,
  pairSecretMessage,
  parsePairingQr,
  type Hello,
  type PairRequest,
  type PairResponse,
  type SyncRequest,
  type SyncResponse,
} from './core';
import { afterApply, startHashing, transferFiles, type Transfer } from './files';
import { SyncNative, errorCode, type Found } from './native';

/** The paired computer, saved on the phone (with the shared secret). */
interface Paired {
  id: string;
  name: string;
  secret: string;
  hosts: string[];
  port: number;
  /** The address that worked last time (tried first). */
  last: string | null;
  pairedAt: number;
}

export type SyncPhase =
  /** Not paired. */
  | 'off'
  /** Looking for the computer. */
  | 'searching'
  | 'connected'
  | 'syncing'
  /** Paired, but the computer isn't reachable (not on the same network, stash closed). */
  | 'offline'
  /** Versions don't match: nothing is touched until one is updated. */
  | 'update-phone'
  | 'update-computer';

export interface SyncState {
  paired: { id: string; name: string; pairedAt: number } | null;
  phase: SyncPhase;
  lastSync: number | null;
  transfer: Transfer | null;
  /** The computer said this phone isn't paired anymore. */
  unpaired: boolean;
}

const PEER = 'sync_peer';
const PULL = 'sync_pull_cursor';
const PUSH = 'sync_push_cursor';
const LAST = 'sync_last';

const readPeer = (): Paired | null => {
  try {
    return JSON.parse(getSettingSync(PEER) ?? 'null');
  } catch {
    return null;
  }
};

let peer: Paired | null = null;
let state: SyncState = {
  paired: null,
  phase: 'off',
  lastSync: null,
  transfer: null,
  unpaired: false,
};
const listeners = new Set<() => void>();
function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const useSync = () => useSyncExternalStore(subscribe, () => state);
export const getSyncState = () => state;

const pairedInfo = (p: Paired | null) =>
  p ? { id: p.id, name: p.name, pairedAt: p.pairedAt } : null;

function savePeer(p: Paired | null) {
  peer = p;
  setSettingSync(PEER, JSON.stringify(p));
  set({ paired: pairedInfo(p) });
}

/** Cursors only move forward (a pass re-reads a little before them). */
function saveCursor(key: string, value: string | null) {
  if (value && value > (getSettingSync(key) ?? '')) setSettingSync(key, value);
}

// ---- finding the computer ----

const baseUrl = (host: string, port: number) => `http://${host}:${port}`;

async function hello(base: string, timeoutMs = 1500): Promise<Hello | null> {
  try {
    const h = JSON.parse(await SyncNative!.hello(base, timeoutMs)) as Hello;
    return h.app === 'stash' ? h : null;
  } catch {
    return null;
  }
}

/**
 * The computer's address: the last one that worked, the ones from pairing,
 * what mDNS finds, and finally a sweep of the local network (a phone hotspot
 * often lets no mDNS through). Null when it isn't reachable.
 */
async function locate(p: Paired): Promise<{ base: string; hello: Hello } | null> {
  const tried = new Set<string>();
  const tryBase = async (host: string, port: number) => {
    const base = baseUrl(host, port);
    if (tried.has(base)) return null;
    tried.add(base);
    const h = await hello(base);
    return h && h.deviceId === p.id ? { base, hello: h } : null;
  };
  const known = [...new Set([p.last, ...p.hosts].filter((h): h is string => !!h))];
  for (const host of known) {
    const hit = await tryBase(host, p.port);
    if (hit) return hit;
  }
  const found: Found[] = await SyncNative!.discover(2500).catch(() => []);
  for (const f of found.filter(x => !x.id || x.id === p.id)) {
    const hit = await tryBase(f.host, f.port);
    if (hit) return hit;
  }
  for (const port of [...new Set([p.port, DEFAULT_PORT])]) {
    const hosts = await SyncNative!.probeSubnet(port, 350).catch(() => [] as string[]);
    for (const host of hosts) {
      const hit = await tryBase(host, port);
      if (hit) return hit;
    }
  }
  return null;
}

// ---- pairing ----

export type PairResult =
  | 'ok'
  | 'not-found'
  | 'wrong-code'
  | 'closed'
  | 'update-phone'
  | 'update-computer'
  | 'failed';

/** Computers with stash open on this network (for pairing with the 6-digit code). */
export async function findComputers(): Promise<{ base: string; hello: Hello }[]> {
  if (!SyncNative) return [];
  const out = new Map<string, { base: string; hello: Hello }>();
  const found = await SyncNative.discover(3000).catch(() => [] as Found[]);
  const bases = found.map(f => baseUrl(f.host, f.port));
  if (!bases.length) {
    const hosts = await SyncNative.probeSubnet(DEFAULT_PORT, 350).catch(() => [] as string[]);
    bases.push(...hosts.map(h => baseUrl(h, DEFAULT_PORT)));
  }
  for (const base of bases) {
    const h = await hello(base);
    if (h && !out.has(h.deviceId)) out.set(h.deviceId, { base, hello: h });
  }
  return [...out.values()];
}

/** Pairs with a computer from its QR code text. */
export async function pairWithQr(text: string): Promise<PairResult> {
  const info = parsePairingQr(text);
  if (!info || !SyncNative) return 'failed';
  if (info.protocol !== PROTOCOL_VERSION) {
    return info.protocol > PROTOCOL_VERSION ? 'update-phone' : 'update-computer';
  }
  for (const host of info.hosts) {
    const base = baseUrl(host, info.port);
    const h = await hello(base, 2500);
    if (h && h.deviceId === info.id) return pairAt(base, h, info.code, info.hosts);
  }
  // The QR code's addresses don't work from here (another network, a hotspot): look around.
  const found = (await findComputers()).find(c => c.hello.deviceId === info.id);
  return found ? pairAt(found.base, found.hello, info.code, info.hosts) : 'not-found';
}

/** Scans the computer's QR code (null: cancelled). */
export const scanPairingQr = () => SyncNative?.scanQr() ?? Promise.resolve(null);

/** Pairs with a computer found on the network, with the code it shows. */
export async function pairAt(
  base: string,
  h: Hello,
  code: string,
  hosts: string[] = [],
): Promise<PairResult> {
  const native = SyncNative;
  if (!native) return 'failed';
  const compat = compatibility(h.protocol);
  if (compat !== 'ok') return compat;
  if (!h.pairing || !h.pub) return 'closed';
  try {
    const pub = await native.keyPair();
    const keys = await native.pairSecret(h.pub, pairSecretMessage(code, h.deviceId, DEVICE_ID));
    const req: PairRequest = {
      protocol: PROTOCOL_VERSION,
      phoneId: DEVICE_ID,
      phoneName: native.deviceName(),
      phonePub: pub,
      proof: keys.proof,
    };
    const res = JSON.parse(await native.pair(base, JSON.stringify(req))) as PairResponse;
    if (res.proof !== keys.expected) return 'failed';
    const host = base.replace(/^http:\/\//, '').replace(/:\d+$/, '');
    const port = Number(base.match(/:(\d+)$/)?.[1] ?? DEFAULT_PORT);
    // A new computer: sync everything from the start.
    setSettingSync(PULL, '');
    setSettingSync(PUSH, '');
    savePeer({
      id: res.deviceId,
      name: res.name || h.name,
      secret: keys.secret,
      hosts: [...new Set([host, ...hosts])],
      port,
      last: host,
      pairedAt: Date.now(),
    });
    set({ unpaired: false });
    connect();
    return 'ok';
  } catch (e) {
    const code = errorCode(e);
    if (code === 'HTTP_403') return 'wrong-code';
    if (code === 'HTTP_426') return 'update-phone';
    return 'failed';
  }
}

/** Forgets the computer (and tells it, if it's there). */
export async function unpair() {
  if (peer && state.phase !== 'offline') {
    await SyncNative?.request('/v1/unpair', '{}').catch(() => {});
  }
  forget();
}

function forget() {
  disconnect();
  savePeer(null);
  set({ phase: 'off' });
}

// ---- the connection ----

let ws: WebSocket | null = null;
let connecting = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 5000;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function disconnect() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const old = ws;
  ws = null;
  old?.close();
}

function retryLater() {
  if (retryTimer || !peer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60_000);
}

/** Finds the computer and opens the WebSocket (then syncs). */
export async function connect(): Promise<void> {
  const p = peer;
  if (!p || !SyncNative || connecting || ws) return;
  connecting = true;
  set({ phase: 'searching' });
  try {
    const where = await locate(p);
    if (!where) {
      set({ phase: 'offline' });
      retryLater();
      return;
    }
    const compat = compatibility(where.hello.protocol);
    if (compat !== 'ok') {
      set({ phase: compat }); // never touch data across versions
      return;
    }
    const host = where.base.replace(/^http:\/\//, '').replace(/:\d+$/, '');
    if (host !== p.last) savePeer({ ...p, last: host, name: where.hello.name || p.name });
    SyncNative.configure(where.base, DEVICE_ID, p.secret, PROTOCOL_VERSION);
    const socket = new WebSocket(await SyncNative.wsUrl());
    ws = socket;
    socket.onopen = () => {
      retryDelay = 5000;
      set({ phase: 'connected' });
      syncNow();
    };
    socket.onmessage = e => {
      if (e.data === PING) scheduleSync();
      else if (e.data === 'unpaired') {
        set({ unpaired: true });
        forget();
      }
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      if (peer) {
        set({ phase: 'offline' });
        retryLater();
      }
    };
    socket.onerror = () => {};
  } catch {
    set({ phase: 'offline' });
    retryLater();
  } finally {
    connecting = false;
  }
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncNow();
  }, SYNC_DEBOUNCE_MS);
}

let running = false;
let rerun = false;

/**
 * One sync pass: the phone's changes go up and the computer's come down, a
 * page at a time, then the missing files both ways.
 */
export async function syncNow(): Promise<void> {
  const p = peer;
  if (!p || !SyncNative) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    await connect();
    return;
  }
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  set({ phase: 'syncing' });
  try {
    let push = hlcMinus(getSettingSync(PUSH), CURSOR_MARGIN_MS);
    let pull = hlcMinus(getSettingSync(PULL), CURSOR_MARGIN_MS);
    for (;;) {
      const lang = syncedLanguage();
      const out = await collectChanges(syncDb, push, p.id, lang ? [lang] : []);
      const req: SyncRequest = { protocol: PROTOCOL_VERSION, since: pull, changes: out.changes };
      const res = JSON.parse(
        await SyncNative.request('/v1/sync', JSON.stringify(req)),
      ) as SyncResponse;
      if (out.cursor) {
        push = out.cursor;
        saveCursor(PUSH, push);
      }
      const applied = await applyChanges(syncDb, syncClock, res.changes, syncedLanguage());
      if (applied.changed) {
        await afterApply(applied);
        notifyLibrary();
      }
      if (res.cursor) {
        pull = res.cursor;
        saveCursor(PULL, pull);
      }
      if (!out.more && !res.more) break;
    }
    const now = Date.now();
    setSettingSync(LAST, String(now));
    set({ lastSync: now });
    await transferFiles(p.name, transfer => set({ transfer }));
    set({ phase: ws ? 'connected' : 'offline' });
  } catch (e) {
    const code = errorCode(e);
    if (code === 'HTTP_401') {
      set({ unpaired: true });
      forget();
    } else if (code === 'HTTP_426') {
      set({ phase: 'update-phone' });
      disconnect();
    } else {
      console.warn('Sync failed', e);
      set({ phase: ws ? 'connected' : 'offline' });
    }
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      scheduleSync();
    }
  }
}

/** Once at startup: back to the paired computer, and watching for changes. */
export async function startSync() {
  if (!SyncNative) return;
  await whenDatabaseReady();
  peer = readPeer();
  const last = Number(getSettingSync(LAST));
  set({ paired: pairedInfo(peer), lastSync: last > 0 ? last : null, phase: peer ? 'offline' : 'off' });
  startHashing();
  onLocalChange(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      scheduleSync();
    }
  });
  AppState.addEventListener('change', s => {
    if (s === 'active' && !ws) {
      retryDelay = 5000;
      connect();
    }
  });
  NetInfo.addEventListener(n => {
    if (n.isConnected && !ws && peer) {
      retryDelay = 5000;
      connect();
    }
  });
  connect();
}
