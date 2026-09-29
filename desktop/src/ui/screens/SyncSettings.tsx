/**
 * Settings → Sync with phone: pairing (a QR code, or the 6-digit code), the
 * paired phone, its status and last sync, Sync now, unpair.
 */
import { ask } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { tr } from '../../core/i18n';
import { toast } from '../../core/state/ui';
import {
  closePairing,
  openPairing,
  pingPhone,
  unpairPhone,
  useSync,
  type SyncState,
} from '../../core/sync/server';
import type { TransferProgress } from '../../core/sync/core';
import { Card, OutlineButton, SectionLabel, SettingRow } from '../kit';

/** "5 min ago" */
function ago(at: number): string {
  const min = Math.floor((Date.now() - at) / 60_000);
  if (min < 1) return tr('sync.justNow');
  if (min < 60) return tr('sync.minutesAgo', { count: min });
  if (min < 24 * 60) return tr('sync.hoursAgo', { count: Math.floor(min / 60) });
  return tr('sync.daysAgo', { count: Math.floor(min / (24 * 60)) });
}

/** "3 files left · about 2 minutes left" */
function transferText(p: TransferProgress): string {
  const files = tr('sync.filesLeft', { count: p.filesLeft });
  if (p.eta == null) return files;
  const time =
    p.eta < 60
      ? tr('sync.secondsLeft', { count: Math.max(1, p.eta) })
      : tr('sync.minutesLeft', { count: Math.ceil(p.eta / 60) });
  return `${files} · ${time}`;
}

function statusText(s: SyncState): string {
  const last = s.lastSync ? tr('sync.lastSync', { time: ago(s.lastSync) }) : tr('sync.never');
  return `${s.status?.connected ? tr('sync.connected') : tr('sync.phoneAway')} · ${last}`;
}

export function SyncSettings() {
  const sync = useSync();
  const [pairing, setPairing] = useState<{ code: string; qr: string } | null>(null);
  const [, redraw] = useState(0);
  const peer = sync.status?.peer ?? null;

  // "5 min ago" moves on.
  useEffect(() => {
    const timer = setInterval(() => redraw(n => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  // Leaving Settings closes pairing.
  useEffect(() => () => void closePairing(), []);
  // Paired (or pairing closed after wrong codes).
  useEffect(() => {
    if (!pairing || sync.status?.pairing) return;
    setPairing(null);
    if (peer) toast(tr('sync.paired', { name: peer.name }));
  }, [sync.status?.pairing]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async () => {
    try {
      setPairing(await openPairing());
    } catch (e) {
      toast(tr('sync.serverError', { error: String(e) }));
    }
  };
  const close = () => {
    setPairing(null);
    closePairing();
  };
  const unpair = async () => {
    if (!peer) return;
    const yes = await ask(tr('sync.unpairBody'), {
      title: tr('sync.unpairTitle', { name: peer.name }),
      kind: 'warning',
      okLabel: tr('sync.unpair'),
      cancelLabel: tr('sync.cancel'),
    });
    if (yes) await unpairPhone();
  };
  const p = sync.transfer;

  return (
    <>
      <SectionLabel>{tr('sync.titleDesktop')}</SectionLabel>
      <Card>
        {sync.error && (
          <SettingRow first title={tr('sync.serverError', { error: sync.error })} />
        )}
        {peer ? (
          <>
            <SettingRow
              first={!sync.error}
              title={peer.name}
              sub={statusText(sync)}
              right={
                <OutlineButton onClick={pingPhone} disabled={!sync.status?.connected}>
                  {tr('sync.syncNow')}
                </OutlineButton>
              }
            >
              {p && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--line)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 4,
                        background: 'var(--ink)',
                        width: `${p.bytesTotal ? Math.round((p.bytesDone / p.bytesTotal) * 100) : 0}%`,
                        transition: 'width .3s',
                      }}
                    />
                  </div>
                  <div className="mono" style={{ marginTop: 6, font: "400 12px 'Geist Mono',monospace", color: 'var(--muted)' }}>
                    {`${tr(p.dir === 'send' ? 'sync.sending' : 'sync.receiving')} · ${transferText(p)}`}
                  </div>
                </div>
              )}
            </SettingRow>
            <SettingRow
              title={tr('sync.unpair')}
              sub={tr('sync.unpairSub', { name: peer.name })}
              right={<OutlineButton onClick={unpair}>{tr('sync.unpair')}</OutlineButton>}
            />
          </>
        ) : (
          <SettingRow
            first={!sync.error}
            title={tr('sync.pairPhone')}
            sub={tr('sync.intro')}
            right={
              pairing ? (
                <OutlineButton onClick={close}>{tr('sync.close')}</OutlineButton>
              ) : (
                <OutlineButton onClick={open} disabled={!sync.status?.running}>
                  {tr('sync.pairPhone')}
                </OutlineButton>
              )
            }
          >
            {pairing && (
              <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
                <div
                  style={{ background: '#fff', borderRadius: 14, padding: 6, lineHeight: 0 }}
                  dangerouslySetInnerHTML={{ __html: pairing.qr }}
                />
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ font: "400 13px/1.45 'Geist',sans-serif", color: 'var(--muted)' }}>
                    {tr('sync.scanThis')}
                  </div>
                  <div style={{ marginTop: 12, font: "400 12px 'Geist',sans-serif", color: 'var(--muted)' }}>
                    {tr('sync.orCode')}
                  </div>
                  <div className="mono" style={{ font: "600 30px 'Geist Mono',monospace", letterSpacing: '.18em', marginTop: 4 }}>
                    {pairing.code}
                  </div>
                  <div style={{ marginTop: 10, font: "400 12px 'Geist',sans-serif", color: 'var(--muted)' }}>
                    {tr('sync.waitingPhone')} {tr('sync.firewall')}
                  </div>
                </div>
              </div>
            )}
          </SettingRow>
        )}
      </Card>
    </>
  );
}
