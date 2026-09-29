/**
 * Hybrid logical clock stamps: "<ms, 13 digits>-<counter, 6 hex>-<device id>".
 *
 * They sort as plain strings, grow with every local change even if the
 * computer's clock goes back, and move past any stamp received from the other
 * device, so an edit made after a sync always wins over what was synced.
 *
 * SHARED FILE: canonical copy in src/sync/core, byte-identical copy in
 * desktop/src/core/sync/core (checked by __tests__/sync.test.ts).
 */

/** Characters before the device id: "0001727000000000-00002a-". */
export const HLC_PREFIX = 21;
const MAX_COUNTER = 0xffffff;
/** A stamp this far ahead of our own clock isn't followed (a phone set to 2035). */
const MAX_DRIFT_MS = 24 * 3600_000;
/**
 * Stamps with a time below this were given to rows that existed before sync
 * (migration): they carry no real edit time, so two of them merge by value.
 */
export const GENESIS_MS = 1000;

export function formatHlc(ms: number, counter: number, device: string): string {
  return `${String(Math.max(0, Math.floor(ms))).padStart(13, '0')}-${counter
    .toString(16)
    .padStart(6, '0')}-${device}`;
}

export function parseHlc(
  h: string | null | undefined,
): { ms: number; counter: number; device: string } | null {
  if (!h || h.length < HLC_PREFIX || h[13] !== '-' || h[20] !== '-') return null;
  const ms = Number(h.slice(0, 13));
  const counter = parseInt(h.slice(14, 20), 16);
  if (!Number.isFinite(ms) || !Number.isFinite(counter)) return null;
  return { ms, counter, device: h.slice(HLC_PREFIX) };
}

export const hlcDevice = (h: string) => h.slice(HLC_PREFIX);
export const isGenesis = (h: string | null | undefined) =>
  !!h && Number(h.slice(0, 13)) < GENESIS_MS;

/** The newest of some stamps ('' when there are none). */
export function maxHlc(...hs: (string | null | undefined)[]): string {
  let best = '';
  for (const h of hs) if (h && h > best) best = h;
  return best;
}

/**
 * A cursor moved `ms` back in time: pulling "since" it again also returns
 * rows whose write was still in flight when the cursor was taken. Merging is
 * idempotent, so getting a row twice is harmless.
 */
export function hlcMinus(h: string | null | undefined, ms: number): string {
  const p = parseHlc(h);
  if (!p) return '';
  return formatHlc(Math.max(0, p.ms - ms), 0, '');
}

export class HybridClock {
  private ms = 0;
  private counter = 0;

  constructor(
    readonly deviceId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Continues after the newest stamp already stored (even one from the future). */
  seed(h: string | null | undefined) {
    const p = parseHlc(h);
    if (p) this.advance(p.ms, p.counter);
  }

  /** A new stamp for a local change. */
  tick(): string {
    const wall = this.now();
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else if (++this.counter > MAX_COUNTER) {
      this.ms++;
      this.counter = 0;
    }
    return formatHlc(this.ms, this.counter, this.deviceId);
  }

  /** Seen in a change from the other device: later local stamps sort after it. */
  receive(h: string | null | undefined) {
    const p = parseHlc(h);
    if (!p || p.ms > this.now() + MAX_DRIFT_MS) return;
    this.advance(p.ms, p.counter);
  }

  private advance(ms: number, counter: number) {
    if (ms > this.ms) {
      this.ms = ms;
      this.counter = counter;
    } else if (ms === this.ms && counter > this.counter) {
      this.counter = counter;
    }
  }
}
