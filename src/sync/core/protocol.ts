/**
 * The phone ↔ computer sync protocol. The computer is the server (Android
 * stops background servers); the phone connects to it over the local network,
 * no internet involved.
 *
 * Endpoints (computer, HTTP + one WebSocket):
 *   GET  /v1/hello              who's there, protocol version, pairing open? (no auth)
 *   POST /v1/pair               PairRequest → PairResponse (no auth, see below)
 *   POST /v1/sync               SyncRequest → SyncResponse
 *   POST /v1/files              FilesRequest → FilesResponse
 *   GET  /v1/file/<sha256>      the file, encrypted frames; `Range: bytes=N-` resumes
 *   GET  /v1/upload/<sha256>    bytes already received of an upload ({"received":N})
 *   PUT  /v1/upload/<sha256>?size=&name=&from=   the file, encrypted frames
 *   GET  /v1/ws?device=&ts=&nonce=&sig=          "changed" pings, both ways
 *   POST /v1/unpair             forget this phone
 *
 * Pairing: the computer shows a 6-digit code (and a QR code with its
 * addresses, port, id and that code). Both sides make an ephemeral P-256 key;
 * the phone gets the computer's from /v1/hello and sends its own in /v1/pair.
 *   shared  = ECDH x-coordinate (32 bytes)
 *   secret  = HMAC-SHA256(shared, "stash-pair-v1|<code>|<computer id>|<phone id>")
 *   encKey  = HMAC-SHA256(secret, "stash-enc")    AES-256-GCM
 *   macKey  = HMAC-SHA256(secret, "stash-mac")    HMAC-SHA256
 *   proofs  = hex HMAC-SHA256(macKey, "stash-pair-phone" | "stash-pair-desktop")
 * Someone listening can't get the secret (ECDH); someone in the middle has
 * one guess at the code, and five wrong codes close pairing.
 *
 * Every later request carries X-Stash-Device, X-Stash-Ts, X-Stash-Nonce and
 *   X-Stash-Sig = hex HMAC-SHA256(macKey,
 *     "<METHOD>\n<path?query>\n<ts>\n<nonce>\n<Range header or ''>\n<hex sha256 of body>")
 * JSON bodies (both ways) are  nonce(12) | AES-GCM(encKey) ciphertext | tag(16),
 * AAD "req:<path>" or "res:<path>". Files travel in 1 MiB chunks, each one frame:
 *   u32 BE length | nonce(12) | ciphertext | tag(16),  AAD "<sha256>:<chunk index>"
 * and are checked against their SHA-256 before use.
 *
 * SHARED FILE: canonical copy in src/sync/core, byte-identical copy in
 * desktop/src/core/sync/core.
 */
import type { ChangeSet } from './model';

/** Bumped on any incompatible change; a mismatch never touches data. */
export const PROTOCOL_VERSION = 1;
export const SERVICE_TYPE = '_stash._tcp';
export const DEFAULT_PORT = 47893;
export const FILE_CHUNK = 1 << 20;
/** Rows per sync request / response. */
export const PAGE_SIZE = 800;
/** Each pass re-reads this much before its cursor (writes still in flight). */
export const CURSOR_MARGIN_MS = 5000;
/** After a "changed" ping or a local change, sync this soon. */
export const SYNC_DEBOUNCE_MS = 1000;
/** WebSocket message: something changed, pull. */
export const PING = 'changed';

export const PAIR_SECRET_PREFIX = 'stash-pair-v1';
export const pairSecretMessage = (
  code: string,
  desktopId: string,
  phoneId: string,
) => `${PAIR_SECRET_PREFIX}|${code}|${desktopId}|${phoneId}`;
export const KEY_ENC = 'stash-enc';
export const KEY_MAC = 'stash-mac';
export const PROOF_PHONE = 'stash-pair-phone';
export const PROOF_DESKTOP = 'stash-pair-desktop';

export interface Hello {
  app: 'stash';
  protocol: number;
  deviceId: string;
  name: string;
  /** Pairing screen open on the computer. */
  pairing: boolean;
  /** Its ephemeral public key (base64 SPKI DER), while pairing is open. */
  pub: string | null;
}

export interface PairRequest {
  protocol: number;
  phoneId: string;
  phoneName: string;
  phonePub: string;
  proof: string;
}

export interface PairResponse {
  deviceId: string;
  name: string;
  proof: string;
}

export interface SyncRequest {
  protocol: number;
  /** The phone's cursor into the computer's changes. */
  since: string;
  /** The phone's changes (one page). */
  changes: ChangeSet;
}

export interface SyncResponse {
  protocol: number;
  changes: ChangeSet;
  /** Where the next pull starts (null: nothing new, keep the old cursor). */
  cursor: string | null;
  more: boolean;
}

export interface FileOffer {
  hash: string;
  size: number;
  /** The file's name on the sending device (kept on the other one). */
  name: string;
}

export interface FilesRequest {
  /** Hashes the phone is missing. */
  want: string[];
}

export interface FilesResponse {
  /** The ones the computer has. */
  have: FileOffer[];
  /** Hashes the computer is missing (the phone uploads the ones it has). */
  want: string[];
}

export type Compatibility = 'ok' | 'update-phone' | 'update-computer';

/** From the phone's point of view, given the computer's version. */
export function compatibility(desktopProtocol: number): Compatibility {
  if (desktopProtocol === PROTOCOL_VERSION) return 'ok';
  return desktopProtocol > PROTOCOL_VERSION ? 'update-phone' : 'update-computer';
}

// ---- the pairing QR code ----

export interface PairingInfo {
  id: string;
  name: string;
  hosts: string[];
  port: number;
  code: string;
}

export function encodePairingQr(p: PairingInfo): string {
  const q = [
    `v=${PROTOCOL_VERSION}`,
    `id=${encodeURIComponent(p.id)}`,
    `n=${encodeURIComponent(p.name)}`,
    `h=${p.hosts.map(encodeURIComponent).join(',')}`,
    `p=${p.port}`,
    `c=${p.code}`,
  ];
  return `stash://pair?${q.join('&')}`;
}

export function parsePairingQr(
  text: string,
): (PairingInfo & { protocol: number }) | null {
  const m = text.trim().match(/^stash:\/\/pair\?(.+)$/);
  if (!m) return null;
  const q: Record<string, string> = {};
  for (const part of m[1].split('&')) {
    const i = part.indexOf('=');
    if (i > 0) q[part.slice(0, i)] = part.slice(i + 1);
  }
  const port = Number(q.p);
  if (!q.id || !q.c || !/^\d{6}$/.test(q.c) || !(port > 0 && port < 65536)) {
    return null;
  }
  return {
    protocol: Number(q.v) || 0,
    id: decodeURIComponent(q.id),
    name: decodeURIComponent(q.n ?? ''),
    hosts: (q.h ?? '')
      .split(',')
      .filter(Boolean)
      .map(decodeURIComponent),
    port,
    code: q.c,
  };
}

// ---- file transfers ----

export interface TransferProgress {
  filesLeft: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  /** Seconds left at the current speed (null until it can be told). */
  eta: number | null;
}

/** Keeps track of speed across a batch of transfers, for "3 files · 1 min left". */
export class TransferMeter {
  private startedAt = 0;
  private done = 0;
  private current = 0;
  private filesDone = 0;

  constructor(
    private readonly filesTotal: number,
    private readonly bytesTotal: number,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  /** Bytes of the file in progress so far. */
  progress(bytes: number) {
    this.current = bytes;
  }

  fileDone(size: number) {
    this.done += size;
    this.current = 0;
    this.filesDone++;
  }

  snapshot(): TransferProgress {
    const bytesDone = Math.min(this.bytesTotal, this.done + this.current);
    const elapsed = (this.now() - this.startedAt) / 1000;
    const speed = elapsed > 1 ? bytesDone / elapsed : 0;
    return {
      filesLeft: this.filesTotal - this.filesDone,
      filesTotal: this.filesTotal,
      bytesDone,
      bytesTotal: this.bytesTotal,
      eta: speed > 0 ? Math.round((this.bytesTotal - bytesDone) / speed) : null,
    };
  }
}
