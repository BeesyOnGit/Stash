/**
 * Wi-Fi sync with the phone app, the computer's side. The server itself runs
 * in Rust (src-tauri/src/sync.rs: HTTP, WebSocket, mDNS, pairing, encryption);
 * each request from the phone arrives here as a `sync-request` event, is
 * answered with the shared merge code (./core), and goes back with `sync_reply`.
 *
 * The phone drives every sync; when something changes here, a "changed" ping
 * over its WebSocket makes it pull within a second.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSyncExternalStore } from 'react';
import {
  getDeviceId,
  getSettingSync,
  notifyLibrary,
  onLocalChange,
  setSettingSync,
  syncDb,
  syncClock,
} from '../db/database';
import { baseName, fs } from '../native';
import { syncedLanguage } from '../services/settings';
import {
  PROTOCOL_VERSION,
  applyChanges,
  collectChanges,
  encodePairingQr,
  localFileFor,
  missingFiles,
  type FilesRequest,
  type FilesResponse,
  type SyncRequest,
  type SyncResponse,
  type TransferProgress,
} from './core';
import { afterApply, placeReceivedFile, startHashing } from './files';

export interface SyncStatus {
  running: boolean;
  port: number;
  hosts: string[];
  name: string;
  deviceId: string;
  peer: { id: string; name: string; pairedAt: number } | null;
  connected: boolean;
  pairing: boolean;
}

export interface SyncState {
  status: SyncStatus | null;
  /** When the phone last synced (ms). */
  lastSync: number | null;
  /** Files going to or from the phone right now. */
  transfer: (TransferProgress & { dir: 'send' | 'receive' }) | null;
  /** The server couldn't start (the port is blocked, …). */
  error: string | null;
}

const LAST_SYNC = 'sync_last';

let state: SyncState = { status: null, lastSync: null, transfer: null, error: null };
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

// ---- requests from the phone ----

async function handle(op: string, body: any): Promise<unknown> {
  if (op === 'sync') {
    const req = body as SyncRequest;
    const peer = state.status?.peer?.id ?? '';
    const applied = await applyChanges(syncDb, syncClock, req.changes, syncedLanguage());
    if (applied.changed) {
      await afterApply(applied);
      notifyLibrary();
    }
    const lang = syncedLanguage();
    const page = await collectChanges(syncDb, req.since, peer, lang ? [lang] : []);
    const now = Date.now();
    setSettingSync(LAST_SYNC, String(now));
    set({ lastSync: now });
    const res: SyncResponse = { protocol: PROTOCOL_VERSION, ...page };
    return res;
  }
  if (op === 'files') {
    const req = body as FilesRequest;
    const res: FilesResponse = { have: [], want: await missingFiles(syncDb) };
    for (const hash of req.want) {
      const path = await localFileFor(syncDb, hash);
      const stat = path ? await fs.stat(path).catch(() => null) : null;
      if (path && stat) res.have.push({ hash, size: stat.size, name: baseName(path) });
    }
    return res;
  }
  if (op === 'resolve') {
    return { path: await localFileFor(syncDb, String(body.hash)) };
  }
  if (op === 'received') {
    await placeReceivedFile(String(body.hash), String(body.path), String(body.name ?? ''));
    return {};
  }
  throw new Error(`Unknown request ${op}`);
}

/** "filesLeft,filesTotal,bytesDone,bytesTotal,eta" from the phone, plus the file in progress. */
function readTransfer(e: {
  dir: 'send' | 'receive';
  done: number;
  total: number;
  batch: string;
}): SyncState['transfer'] {
  const [filesLeft, filesTotal, bytesDone, bytesTotal, eta] = e.batch.split(',').map(Number);
  if (!(filesTotal > 0)) return null;
  return {
    dir: e.dir,
    filesLeft,
    filesTotal,
    bytesDone: Math.min(bytesTotal, bytesDone + e.done),
    bytesTotal,
    eta: eta >= 0 ? eta : null,
  };
}

let started = false;
let clearTransfer: ReturnType<typeof setTimeout> | null = null;

/** Once at startup, after the database: the server, file hashing, pings. */
export async function startSync() {
  if (started) return;
  started = true;
  const saved = Number(getSettingSync(LAST_SYNC));
  set({ lastSync: saved > 0 ? saved : null });
  await listen<{ id: number; op: string; body: unknown }>('sync-request', async e => {
    const { id, op, body } = e.payload;
    try {
      const out = await handle(op, body);
      await invoke('sync_reply', { id, ok: true, body: out ?? {} });
    } catch (err) {
      console.warn(`Sync request ${op} failed`, err);
      await invoke('sync_reply', { id, ok: false, body: String(err) });
    }
  });
  await listen<SyncStatus>('sync-status', e => set({ status: e.payload }));
  await listen<{ dir: 'send' | 'receive'; hash: string; done: number; total: number; batch: string }>(
    'sync-transfer',
    e => {
      const transfer = readTransfer(e.payload);
      set({ transfer });
      if (clearTransfer) clearTimeout(clearTransfer);
      clearTransfer = setTimeout(() => set({ transfer: null }), 4000);
    },
  );
  // A local change: the phone pulls it (coalesced).
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  onLocalChange(() => {
    if (!state.status?.connected) return;
    if (pingTimer) clearTimeout(pingTimer);
    pingTimer = setTimeout(() => invoke('sync_ping').catch(() => {}), 300);
  });
  startHashing();
  try {
    set({ status: await invoke<SyncStatus>('sync_start', { deviceId: getDeviceId() }), error: null });
  } catch (e) {
    set({ error: String(e) });
  }
}

// ---- Settings → Sync ----

export const refreshSyncStatus = async () =>
  set({ status: await invoke<SyncStatus>('sync_status') });

/** Opens pairing: the 6-digit code and the QR code (SVG) for the phone to scan. */
export async function openPairing(): Promise<{ code: string; qr: string }> {
  const code = await invoke<string>('sync_pair_open');
  const status = await invoke<SyncStatus>('sync_status');
  set({ status });
  const text = encodePairingQr({
    id: status.deviceId,
    name: status.name,
    hosts: status.hosts,
    port: status.port,
    code,
  });
  return { code, qr: await invoke<string>('sync_qr', { text }) };
}

export const closePairing = () => invoke<void>('sync_pair_close').catch(() => {});
/** Sync now: the phone pulls and pushes right away (it drives every sync). */
export const pingPhone = () => invoke<void>('sync_ping').catch(() => {});
export const unpairPhone = () => invoke<void>('sync_unpair');
