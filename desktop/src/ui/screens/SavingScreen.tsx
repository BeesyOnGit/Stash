/** Saving: storage, what's downloading, what was saved this session, and karaoke recordings. */
import { ask } from '@tauri-apps/plugin-dialog';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { tr } from '../../core/i18n';
import { fileSrc } from '../../core/native';
import { useDownloads, useLibrary } from '../../core/player/hooks';
import { PlayerService } from '../../core/player/PlayerService';
import { getActiveDownloadIds, getDownloadProgress } from '../../core/services/downloader';
import {
  deleteRecording,
  getRecordingList,
  recordingName,
  shareRecording,
  showInFolder,
  subscribeRecordings,
  type Recording,
} from '../../core/services/karaokeRecordings';
import { formatBytes, limitBytes } from '../../core/services/storage';
import { openSheet, toast } from '../../core/state/ui';
import { formatTime, paletteFor, useCoverColors } from '../../core/theme';
import { artworkUri, type Track } from '../../core/types';
import { CheckCircleIcon, FolderIcon, PauseIcon, PencilIcon, PlayIcon, ShareIcon, TrashIcon } from '../icons';
import { ACCENT, Card, Cover, Note } from '../kit';
import { SESSION_START } from './LibraryScreen';

export const useRecordings = () => useSyncExternalStore(subscribeRecordings, getRecordingList);

// ---- playing a recording (one at a time) ----

let recAudio: HTMLAudioElement | null = null;
let recId: string | null = null;
const recListeners = new Set<() => void>();
let recVersion = 0;
const recEmit = () => {
  recVersion++;
  recListeners.forEach(fn => fn());
};
function toggleRecording(r: Recording) {
  if (recId === r.id && recAudio) {
    recAudio.pause();
    recAudio = null;
    recId = null;
    recEmit();
    return;
  }
  recAudio?.pause();
  PlayerService.pause();
  const a = new Audio(fileSrc(r.path));
  a.ontimeupdate = recEmit;
  a.onended = () => {
    recAudio = null;
    recId = null;
    recEmit();
  };
  a.play().catch(() => {});
  recAudio = a;
  recId = r.id;
  recEmit();
}
const useRecPlayback = () =>
  useSyncExternalStore(
    fn => {
      recListeners.add(fn);
      return () => {
        recListeners.delete(fn);
      };
    },
    () => recVersion,
  );

export function SavingScreen() {
  useCoverColors();
  useDownloads();
  const { tracks, byId } = useLibrary();
  const recordings = useRecordings();
  const downloaded = tracks
    .filter(t => t.source !== 'device' && t.status === 'ready')
    .reduce((a, t) => a + (t.sizeBytes ?? 0), 0);
  const active = getActiveDownloadIds()
    .map(id => byId.get(id))
    .filter((t): t is Track => !!t);
  const saved = tracks
    .filter(t => t.savedAt && t.savedAt >= SESSION_START && t.status === 'ready')
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  const pct = Math.min(100, (downloaded / limitBytes()) * 100);

  const groups = new Map<string, Recording[]>();
  for (const r of recordings) {
    const k = r.trackId ?? `t:${r.title}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <div data-screen-label="Saving" style={{ maxWidth: 820, padding: '28px 32px 24px' }}>
      <h1 style={{ margin: 0, font: "700 40px/1.05 'Geist',sans-serif", letterSpacing: '-.035em' }}>
        {tr('library.savingTitle')}
      </h1>
      <Card style={{ marginTop: 18, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ font: "600 14px 'Geist',sans-serif" }}>{tr('library.offlineStorage')}</span>
          <span style={{ font: "400 12px 'Geist Mono',monospace", color: 'var(--muted)' }}>
            {formatBytes(downloaded)} {tr('desktop.storageOf', { size: formatBytes(limitBytes()) })}
          </span>
        </div>
        <div style={{ marginTop: 10, height: 8, borderRadius: 4, background: 'var(--fill3)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.max(1, pct)}%`, background: 'var(--ink)', borderRadius: 4 }} />
        </div>
      </Card>

      <Heading>{tr('library.inProgress')}</Heading>
      {!active.length && <Note>{tr('library.nothingSaving')}</Note>}
      {active.map(t => {
        const p = Math.round((getDownloadProgress(t.id) ?? 0) * 100);
        const art = artworkUri(t);
        return (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0' }}>
            <Cover src={art} size={46} radius={9} bg={paletteFor(t, art).artBg} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span className="ellipsis" style={{ font: "500 14px/1.25 'Geist',sans-serif" }}>
                  {t.title} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {t.artist ?? ''}</span>
                </span>
                <span style={{ font: "500 12px 'Geist Mono',monospace", color: 'var(--accentInk)' }}>{p}%</span>
              </div>
              <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: 'var(--accentSoft2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${p}%`, background: ACCENT }} />
              </div>
            </div>
          </div>
        );
      })}

      <Heading>{tr('library.savedSession')}</Heading>
      {!saved.length && <Note>{tr('library.savedSessionEmpty')}</Note>}
      {saved.map(t => {
        const art = artworkUri(t);
        return (
          <div
            key={t.id}
            className="h-fill"
            onClick={() => PlayerService.playQueue([t], 0, tr('library.savingTitle'), false)}
            onContextMenu={e => {
              e.preventDefault();
              openSheet({ kind: 'menu', track: t });
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 10px', margin: '0 -10px', borderRadius: 10, cursor: 'pointer' }}
          >
            <Cover src={art} size={46} radius={9} bg={paletteFor(t, art).artBg} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ellipsis" style={{ font: "500 14px/1.25 'Geist',sans-serif" }}>{t.title}</div>
              <div style={{ font: "400 13px/1.35 'Geist',sans-serif", color: 'var(--muted)' }}>
                {t.artist ?? tr('common.unknownArtist')} · {formatBytes(t.sizeBytes ?? 0)}
              </div>
            </div>
            <CheckCircleIcon size={18} color="oklch(0.58 0.13 155)" />
          </div>
        );
      })}

      <div style={{ padding: '26px 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: "600 15px 'Geist',sans-serif" }}>{tr('karaoke.recordings')}</span>
        <button
          onClick={() => showInFolder().catch(() => toast(tr('karaoke.folderUnavailable', { folder: 'Music/Karaoke' })))}
          style={{ border: '1px solid var(--line2)', background: 'transparent', color: 'var(--ink)', font: "500 12px 'Geist',sans-serif", padding: '6px 11px', borderRadius: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <FolderIcon size={14} />
          {tr('karaoke.showInFolder')}
        </button>
      </div>
      {!recordings.length && <Note>{tr('desktop.recordingsEmpty')}</Note>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 12 }}>
        {[...groups.entries()].map(([k, recs]) => (
          <RecordingGroup key={k} recs={recs} track={recs[0].trackId ? byId.get(recs[0].trackId) : undefined} />
        ))}
      </div>
    </div>
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: '26px 0 10px', font: "600 15px 'Geist',sans-serif" }}>{children}</div>
);

function RecordingGroup({ recs, track }: { recs: Recording[]; track?: Track }) {
  useRecPlayback();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!recs.some(r => r.id === recId)) return;
    const id = setInterval(() => tick(x => x + 1), 250);
    return () => clearInterval(id);
  });
  const first = recs[0];
  const art = track ? artworkUri(track) : null;
  const pal = paletteFor({ title: first.title, artist: first.artist }, art);
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
        <Cover src={art} size={36} bg={pal.artBg} />
        <div style={{ minWidth: 0 }}>
          <div className="ellipsis" style={{ font: "600 14px 'Geist',sans-serif" }}>{first.title}</div>
          <div style={{ font: "400 12px 'Geist',sans-serif", color: 'var(--muted)' }}>
            {first.artist ?? tr('common.unknownArtist')} · {tr('desktop.takes', { count: recs.length })}
          </div>
        </div>
      </div>
      {recs.map(r => {
        const playing = recId === r.id;
        const p = playing && recAudio && r.duration ? (recAudio.currentTime / r.duration) * 100 : 0;
        const meta = [
          formatTime(r.duration),
          new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          r.mode === 'instrumental' ? tr('desktop.modeNoVocals') : r.mode === 'original' ? tr('desktop.modeOverSong') : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px 10px 14px' }}>
            <button
              onClick={() => toggleRecording(r)}
              aria-label={tr('desktop.playRecording')}
              style={{ width: 34, height: 34, borderRadius: '50%', border: 0, background: 'var(--ink)', color: 'var(--onInk)', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none' }}
            >
              {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
            </button>
            <div style={{ flex: 1, minWidth: 0, paddingInlineStart: 4 }}>
              <div className="ellipsis" style={{ font: "500 14px 'Geist',sans-serif" }}>{recordingName(r)}</div>
              <div style={{ font: "400 12px 'Geist Mono',monospace", color: 'var(--muted2)' }}>{meta}</div>
              {playing && (
                <div style={{ marginTop: 5, height: 3, borderRadius: 2, background: 'var(--fill3)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${p}%`, background: ACCENT }} />
                </div>
              )}
            </div>
            <SmallIcon title={tr('karaoke.rename')} onClick={() => openSheet({ kind: 'rename', recording: r })}>
              <PencilIcon size={16} />
            </SmallIcon>
            <SmallIcon
              title={tr('desktop.shareHint')}
              onClick={async () => {
                try {
                  if (await shareRecording(r)) toast(tr('desktop.shared', { name: recordingName(r) }));
                } catch (e: any) {
                  toast(String(e?.message ?? e));
                }
              }}
            >
              <ShareIcon size={16} />
            </SmallIcon>
            <SmallIcon
              title={tr('common.delete')}
              onClick={async () => {
                const ok = await ask(tr('desktop.deleteHint'), {
                  title: tr('karaoke.deleteConfirm', { name: recordingName(r) }),
                  kind: 'warning',
                });
                if (!ok) return;
                if (recId === r.id) toggleRecording(r);
                await deleteRecording(r);
                toast(tr('karaoke.deleted'));
              }}
            >
              <TrashIcon size={16} />
            </SmallIcon>
          </div>
        );
      })}
    </Card>
  );
}

const SmallIcon = ({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className="h-fill2"
    style={{ width: 32, height: 32, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none' }}
  >
    {children}
  </button>
);
