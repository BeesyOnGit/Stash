/**
 * The Android side of Wi-Fi sync (android/.../sync/SyncModule.kt): finding
 * the computer, pairing keys, signed + encrypted requests, file transfers,
 * the QR scanner and the transfer notification.
 */
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export interface Found {
  host: string;
  port: number;
  id: string;
}

interface Native {
  configure(base: string, device: string, secret: string, protocol: number): void;
  deviceName(): string;
  keyPair(): Promise<string>;
  pairSecret(
    peerPub: string,
    message: string,
  ): Promise<{ secret: string; proof: string; expected: string }>;
  hello(base: string, timeoutMs: number): Promise<string>;
  pair(base: string, body: string): Promise<string>;
  request(path: string, json: string): Promise<string>;
  wsUrl(): Promise<string>;
  download(hash: string, dest: string, batch: string): Promise<number>;
  upload(hash: string, path: string, name: string, batch: string): Promise<number>;
  cancelTransfers(): void;
  discover(timeoutMs: number): Promise<Found[]>;
  probeSubnet(port: number, timeoutMs: number): Promise<string[]>;
  scanQr(): Promise<string | null>;
  startForeground(title: string, text: string): void;
  updateForeground(title: string, text: string, percent: number): void;
  stopForeground(): void;
}

export const SyncNative: Native | undefined =
  Platform.OS === 'android' ? NativeModules.StashSync : undefined;

const emitter = SyncNative ? new NativeEventEmitter(NativeModules.StashSync) : null;

/** Bytes of the file being transferred right now. */
export function onTransferProgress(
  fn: (e: { dir: 'send' | 'receive'; hash: string; done: number; total: number }) => void,
) {
  const sub = emitter?.addListener('StashSyncProgress', e => fn(e as never));
  return () => sub?.remove();
}

/** The error code a native call rejected with ("HTTP_401", "NETWORK", …). */
export const errorCode = (e: unknown) =>
  String((e as { code?: string })?.code ?? (e as Error)?.message ?? e);
