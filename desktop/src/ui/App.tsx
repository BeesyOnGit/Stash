/** The window: title bar (with search), sidebar, the screen, the Now playing panel, the player bar and what opens over them. */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { tr, useLanguage } from '../core/i18n';
import { useCurrentTrack, useLibrary } from '../core/player/hooks';
import { PlayerService } from '../core/player/PlayerService';
import { useDownloads } from '../core/player/hooks';
import { getActiveDownloadIds } from '../core/services/downloader';
import { smartListName, smartTracks, SMART_LISTS } from '../core/services/smartLists';
import { formatBytes, limitBytes } from '../core/services/storage';
import { useSettings } from '../core/services/settings';
import { getUi, openSheet, useUi } from '../core/state/ui';
import { artworkUri } from '../core/types';
import { goTab, openCollection, setApp, useApp, type Tab } from './appState';
import {
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
  HeartIcon,
  LibraryIcon,
  Logo,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  SlidersIcon,
  SquareIcon,
  StatsIcon,
} from './icons';
import { KaraokeScreen } from './KaraokeScreen';
import { ACCENT, CoverGrid } from './kit';
import { FullScreenPlayer } from './player/FullScreenPlayer';
import { NowPlayingPanel } from './player/NowPlayingPanel';
import { PlayerBar } from './player/PlayerBar';
import { CollectionScreen } from './screens/CollectionScreen';
import { LibraryScreen, SMART_COLORS, SMART_SUB, SmartIcon } from './screens/LibraryScreen';
import { SavingScreen } from './screens/SavingScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StatsScreen } from './screens/StatsScreen';
import { Sheets } from './Sheets';

const SIDE_DEFAULT = 232;
const PANEL_DEFAULT = 340;

function loadLayout(): { side: number; panel: number } {
  try {
    const l = JSON.parse(localStorage.getItem('stash-desktop-layout') || '{}');
    return { side: l.sideW ?? SIDE_DEFAULT, panel: l.panelW ?? PANEL_DEFAULT };
  } catch {
    return { side: SIDE_DEFAULT, panel: PANEL_DEFAULT };
  }
}

export function App() {
  useLanguage();
  const app = useApp();
  const cur = useCurrentTrack();
  const [layout, setLayout] = useState(loadLayout);
  const [resizing, setResizing] = useState<'side' | 'panel' | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const saveLayout = (next: { side: number; panel: number }) => {
    setLayout(next);
    try {
      localStorage.setItem('stash-desktop-layout', JSON.stringify({ sideW: next.side, panelW: next.panel }));
    } catch {}
  };

  const resize = (e: RPointerEvent, which: 'side' | 'panel') => {
    if (e.button) return;
    e.preventDefault();
    const sx = e.clientX;
    const start = which === 'side' ? layout.side : layout.panel;
    let next = layout;
    const rtl = document.dir === 'rtl';
    const mv = (ev: PointerEvent) => {
      let d = ev.clientX - sx;
      if (rtl) d = -d;
      if (which === 'panel') d = -d;
      const w = which === 'side' ? Math.min(360, Math.max(184, start + d)) : Math.min(520, Math.max(300, start + d));
      next = which === 'side' ? { ...layout, side: w } : { ...layout, panel: w };
      setLayout(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      setResizing(null);
      saveLayout(next);
    };
    document.body.style.cursor = 'col-resize';
    setResizing(which);
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  // Keyboard: Space, L, F, Ctrl+←/→, Ctrl+K, Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        goTab('search');
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (e.key === 'Escape') {
        if (getUi().sheet) return; // the dialog closes itself
        if (app.fullScreen) setApp({ fullScreen: false });
        else if (app.selecting) setApp({ selecting: false, selected: [] });
        if (typing) (e.target as HTMLElement).blur();
        return;
      }
      if (typing || app.karaoke || !PlayerService.current) return;
      if (e.code === 'Space') {
        e.preventDefault();
        PlayerService.togglePlay();
      } else if (e.key === 'l' || e.key === 'L') {
        setApp(s => ({ lyrics: !(s.lyrics && (s.panel || s.fullScreen)), panel: true }));
      } else if (e.key === 'f' || e.key === 'F') {
        setApp(s => ({ fullScreen: !s.fullScreen }));
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') {
        PlayerService.next();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') {
        PlayerService.previous();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app.fullScreen, app.karaoke, app.selecting]);

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--ink)' }}>
      <TitleBar logoW={layout.side - 16} searchRef={searchRef} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Sidebar width={layout.side} onResize={e => resize(e, 'side')} onReset={() => saveLayout({ ...layout, side: SIDE_DEFAULT })} grip={resizing === 'side'} />
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {app.tab === 'library' && (app.detail ? <CollectionScreen detail={app.detail} /> : <LibraryScreen />)}
          {app.tab === 'search' && <SearchScreen />}
          {app.tab === 'saving' && <SavingScreen />}
          {app.tab === 'stats' && <StatsScreen />}
          {app.tab === 'settings' && <SettingsScreen />}
        </main>
        {cur && app.panel && (
          <NowPlayingPanel width={layout.panel} onResize={e => resize(e, 'panel')} onResetSize={() => saveLayout({ ...layout, panel: PANEL_DEFAULT })} grip={resizing === 'panel'} />
        )}
      </div>
      <PlayerBar />
      {cur && app.fullScreen && <FullScreenPlayer />}
      {app.karaoke && <KaraokeScreen key={app.karaoke} trackId={app.karaoke} />}
      <Toast />
      <Sheets />
    </div>
  );
}

function Toast() {
  const { toast } = useUi();
  if (!toast) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 100,
        transform: 'translateX(-50%)',
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 16px',
        borderRadius: 12,
        background: 'var(--ink)',
        color: 'var(--onInk)',
        boxShadow: '0 10px 30px rgba(0,0,0,.25)',
        font: "500 13px/1.35 'Geist',sans-serif",
        animation: 'fadeIn .2s',
        maxWidth: '70%',
      }}
    >
      <CheckCircleIcon size={18} color="oklch(0.78 0.14 155)" />
      <span>{toast.text}</span>
    </div>
  );
}

function TitleBar({ logoW, searchRef }: { logoW: number; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const { query } = useApp();
  const win = getCurrentWindow();
  const winBtn = { width: 40, height: 32, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--ink2)', display: 'grid', placeItems: 'center', cursor: 'pointer' } as const;
  return (
    <div data-tauri-drag-region style={{ height: 48, flex: 'none', display: 'flex', alignItems: 'center', gap: 16, padding: '0 8px 0 16px', borderBottom: '1px solid var(--line)' }}>
      <div data-tauri-drag-region style={{ width: logoW, display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
        <Logo size={22} />
        <span data-tauri-drag-region style={{ font: "700 16px 'Geist',sans-serif", letterSpacing: '-.03em' }}>stash desktop</span>
      </div>
      <div data-tauri-drag-region style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: 420, maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 12px', borderRadius: 10, background: 'var(--fill2)' }}>
          <SearchIcon size={16} color="var(--muted)" />
          <input
            ref={searchRef}
            value={query}
            onChange={e => setApp({ query: e.target.value, tab: 'search', detail: null })}
            onFocus={() => setApp({ tab: 'search', detail: null })}
            placeholder={tr('desktop.searchPlaceholder')}
            spellCheck={false}
            style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', font: "400 14px 'Geist',sans-serif", color: 'var(--ink)' }}
          />
          {!!query && (
            <button
              onClick={() => setApp({ query: '' })}
              aria-label={tr('library.clearSearch')}
              style={{ width: 20, height: 20, borderRadius: '50%', border: 0, background: 'var(--fill3)', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}
            >
              <CloseIcon size={9} stroke={4} />
            </button>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
        <button className="h-fill2" style={winBtn} title={tr('desktop.minimize')} onClick={() => win.minimize()}>
          <MinusIcon size={14} />
        </button>
        <button className="h-fill2" style={winBtn} title={tr('desktop.maximize')} onClick={() => win.toggleMaximize()}>
          <SquareIcon size={13} />
        </button>
        <button className="h-close" style={winBtn} title={tr('desktop.closeToTray')} onClick={() => win.close()}>
          <CloseIcon size={14} stroke={2} />
        </button>
      </div>
    </div>
  );
}

function Sidebar({ width, onResize, onReset, grip }: { width: number; onResize: (e: RPointerEvent) => void; onReset: () => void; grip: boolean }) {
  const { tab, detail } = useApp();
  const { tracks, playlists, byId } = useLibrary();
  const dark = useSettings().theme === 'dark';
  useDownloads();
  const active = getActiveDownloadIds().length;
  const liked = tracks.filter(t => t.liked && t.status === 'ready').length;
  const downloaded = tracks.filter(t => t.source !== 'device' && t.status === 'ready').reduce((a, t) => a + (t.sizeBytes ?? 0), 0);
  const limit = limitBytes();
  const pct = Math.min(100, Math.max(1, (downloaded / limit) * 100));
  const barColor = downloaded > limit ? ACCENT : downloaded > limit * 0.85 ? 'oklch(0.72 0.15 70)' : 'var(--ink)';

  const nav: Array<[Tab, string, React.ReactNode]> = [
    ['library', tr('settings.tabLibrary'), <LibraryIcon size={20} />],
    ['search', tr('settings.tabSearch'), <SearchIcon size={20} stroke={2} />],
    ['stats', tr('settings.tabStats'), <StatsIcon size={20} stroke={2} />],
    ['saving', tr('settings.tabSaving'), <DownloadIcon size={20} />],
    ['settings', tr('settings.tabSettings'), <SlidersIcon size={20} />],
  ];

  const item = (key: string, cover: React.ReactNode, name: string, meta: string, onClick: () => void, on: boolean) => (
    <div key={key} className="h-fill" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 10, cursor: 'pointer', background: on ? 'var(--fill2)' : undefined }}>
      {cover}
      <div style={{ minWidth: 0 }}>
        <div className="ellipsis" style={{ font: "500 14px 'Geist',sans-serif" }}>{name}</div>
        <div className="ellipsis" style={{ font: "400 12px 'Geist',sans-serif", color: 'var(--muted)' }}>{meta}</div>
      </div>
    </div>
  );
  const isDetail = (d: typeof detail) => tab === 'library' && !!detail && JSON.stringify(detail) === JSON.stringify(d);

  return (
    <nav style={{ position: 'relative', width, flex: 'none', display: 'flex', flexDirection: 'column', borderInlineEnd: '1px solid var(--line)', padding: '12px 10px', gap: 2, minHeight: 0 }}>
      <div
        onPointerDown={onResize}
        onDoubleClick={onReset}
        title={tr('desktop.resizeHint')}
        className="grip"
        style={{ position: 'absolute', top: 0, bottom: 0, insetInlineEnd: -4, width: 7, zIndex: 6, cursor: 'col-resize', touchAction: 'none', background: grip ? 'linear-gradient(90deg,transparent 2.5px,#E0532F 2.5px,#E0532F 4.5px,transparent 4.5px)' : 'transparent' }}
      />
      {nav.map(([k, label, icon]) => (
        <button
          key={k}
          className="h-fill"
          onClick={() => goTab(k)}
          style={{ position: 'relative', border: 0, height: 38, borderRadius: 10, background: tab === k && !(k === 'library' && detail) ? 'var(--fill2)' : 'transparent', color: tab === k ? 'var(--ink)' : 'var(--muted2)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', cursor: 'pointer', font: "500 14px 'Geist',sans-serif", textAlign: 'start' }}
        >
          {icon}
          <span style={{ color: 'var(--ink)' }}>{label}</span>
          {k === 'saving' && active > 0 && (
            <span className="mono" style={{ marginInlineStart: 'auto', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: ACCENT, color: '#fff', font: "600 11px/18px 'Geist Mono',monospace", textAlign: 'center' }}>
              {active}
            </span>
          )}
        </button>
      ))}
      <div style={{ margin: '18px 12px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="eyebrow" style={{ fontSize: 11 }}>{tr('desktop.playlists')}</span>
        <button className="h-fill2" onClick={() => openSheet({ kind: 'new' })} title={tr('library.newPlaylist')} style={{ width: 24, height: 24, border: 0, borderRadius: 6, background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <PlusIcon size={14} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {item(
          'liked',
          <div style={{ width: 34, height: 34, borderRadius: 8, background: ACCENT, display: 'grid', placeItems: 'center', color: '#fff', flex: 'none' }}>
            <HeartIcon filled size={16} />
          </div>,
          tr('library.likedSongs'),
          tr('common.songs', { count: liked }),
          () => openCollection({ kind: 'liked' }),
          isDetail({ kind: 'liked' }),
        )}
        {SMART_LISTS.map(s => {
          const [bg, ink] = SMART_COLORS[s.id];
          return item(
            s.id,
            <div style={{ width: 34, height: 34, borderRadius: 8, background: dark ? ink : bg, color: dark ? bg : ink, display: 'grid', placeItems: 'center', flex: 'none' }}>
              <SmartIcon id={s.id} size={16} />
            </div>,
            smartListName(s.id),
            `${tr('common.songs', { count: smartTracks(s.id, tracks).length })} · ${tr(SMART_SUB[s.id])}`,
            () => openCollection({ kind: 'smart', id: s.id }),
            isDetail({ kind: 'smart', id: s.id }),
          );
        })}
        {playlists.map(p =>
          item(
            p.id,
            <CoverGrid srcs={p.trackIds.slice(0, 4).map(id => { const t = byId.get(id); return t ? artworkUri(t) : null; })} size={34} radius={8} />,
            p.name,
            tr('common.songs', { count: p.trackIds.filter(id => byId.has(id)).length }),
            () => openCollection({ kind: 'playlist', id: p.id }),
            isDetail({ kind: 'playlist', id: p.id }),
          ),
        )}
      </div>
      <div onClick={() => goTab('settings')} style={{ marginTop: 8, padding: 12, borderRadius: 12, background: 'var(--fill)', cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', font: "500 12px 'Geist',sans-serif" }}>
          <span>{formatBytes(downloaded)}</span>
          <span style={{ color: 'var(--muted)' }}>{tr('desktop.storageOf', { size: formatBytes(limit) })}</span>
        </div>
        <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: 'var(--fill3)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3 }} />
        </div>
      </div>
    </nav>
  );
}
