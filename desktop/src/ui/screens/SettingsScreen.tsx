/** Settings, grouped as in the design: storage, library, saving, sources, listening, karaoke, appearance, keyboard, app. */
import { relaunch } from '@tauri-apps/plugin-process';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { directionPending, LANGUAGES, tr, type Key } from '../../core/i18n';
import { useLibrary, useCurrentTrack } from '../../core/player/hooks';
import { scanDeviceMusic } from '../../core/services/deviceScanner';
import {
  deleteModel,
  getKaraokeVersion,
  getModelState,
  MODEL,
  refreshModelState,
  subscribeKaraoke,
} from '../../core/services/karaoke';
import {
  saveSettings,
  speedLabel,
  useSettings,
  type RingColor,
  type SongChange,
  type VinylStyle,
  type YoutubeBackend,
} from '../../core/services/settings';
import { formatBytes, formatGB, limitBytes } from '../../core/services/storage';
import { checkForUpdate, installedVersion, updatesSupported } from '../../core/services/updater';
import { openSheet, toast } from '../../core/state/ui';
import { paletteFor } from '../../core/theme';
import { artworkUri } from '../../core/types';
import { goTab } from '../appState';
import { Logo } from '../icons';
import { ACCENT, Card, OutlineButton, Segmented, SectionLabel, SettingRow, Spinner, Toggle, Vinyl } from '../kit';
import { useRecordings } from './SavingScreen';
import { SyncSettings } from './SyncSettings';

export const RING_COLORS: Record<RingColor, string> = {
  white: '#FFFFFF',
  orange: '#E0532F',
  cover: 'cover',
  green: 'oklch(0.78 0.14 155)',
  blue: 'oklch(0.7 0.14 245)',
};
const RING_NAME: Record<RingColor, Key> = {
  white: 'settings.ringWhite',
  orange: 'settings.ringOrange',
  cover: 'settings.ringCover',
  green: 'settings.ringGreen',
  blue: 'settings.ringBlue',
};

export function SettingsScreen() {
  const s = useSettings();
  const { tracks } = useLibrary();
  const cur = useCurrentTrack();
  const recordings = useRecordings();
  useSyncExternalStore(subscribeKaraoke, getKaraokeVersion);
  const model = getModelState();
  const [scanning, setScanning] = useState(false);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    refreshModelState();
  }, []);

  const downloaded = tracks
    .filter(t => t.source !== 'device' && t.status === 'ready')
    .reduce((a, t) => a + (t.sizeBytes ?? 0), 0);
  const limit = limitBytes();
  const over = downloaded > limit;
  const pct = Math.min(100, Math.max(1, (downloaded / limit) * 100));
  const barColor = over ? ACCENT : downloaded > limit * 0.85 ? 'oklch(0.72 0.15 70)' : 'var(--ink)';
  const readyCount = tracks.filter(t => t.status === 'ready').length;
  const preview = cur ?? tracks.find(t => t.status === 'ready');
  const previewArt = preview ? artworkUri(preview) : null;
  const pal = preview ? paletteFor(preview, previewArt) : paletteFor({ title: 'stash', artist: null });
  const ver = installedVersion();

  const scan = async () => {
    setScanning(true);
    try {
      const r = await scanDeviceMusic();
      toast(tr('desktop.scanDone', { count: r.total, added: r.added }));
    } catch (e: any) {
      toast(String(e?.message ?? e));
    } finally {
      setScanning(false);
    }
  };

  const check = async () => {
    setChecking(true);
    try {
      const r = await checkForUpdate();
      if (r) openSheet({ kind: 'update', release: r });
      else toast(tr('settings.upToDate'));
    } catch {
      toast(tr('settings.noGithub'));
    } finally {
      setChecking(false);
    }
  };

  const langName = (LANGUAGES.find(l => l.code === s.language)?.name ?? null) as string | null;

  return (
    <div data-screen-label="Settings" style={{ maxWidth: 720, padding: '28px 32px 32px' }}>
      <h1 style={{ margin: 0, font: "700 40px/1.05 'Geist',sans-serif", letterSpacing: '-.035em' }}>
        {tr('settings.title')}
      </h1>

      <SectionLabel>{tr('settings.sectionStorage')}</SectionLabel>
      <Card style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ font: "600 22px 'Geist',sans-serif", letterSpacing: '-.02em' }}>{formatBytes(downloaded)}</span>
          <span style={{ font: "400 13px 'Geist',sans-serif", color: 'var(--muted)' }}>
            {tr('settings.storageOf', { size: formatGB(s.storageLimitGB) })}
          </span>
        </div>
        <div style={{ marginTop: 12, height: 10, borderRadius: 5, background: 'var(--fill3)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 5, transition: 'width .3s' }} />
        </div>
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', font: "400 12px 'Geist Mono',monospace", color: 'var(--muted)' }}>
          <span>{tr('common.songs', { count: readyCount })}</span>
          <span>{tr('settings.storageFree', { size: formatBytes(Math.max(0, limit - downloaded)) })}</span>
        </div>
        {over && (
          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--accentSoft)', color: 'var(--accentInk)', font: "500 13px/1.4 'Geist',sans-serif" }}>
            {tr('settings.storageOver')}
          </div>
        )}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <span style={{ font: "500 15px 'Geist',sans-serif" }}>{tr('settings.storageLimit')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 8, 16].map(g => {
              const on = s.storageLimitGB === g;
              return (
                <button
                  key={g}
                  onClick={() => saveSettings({ storageLimitGB: g })}
                  style={{
                    border: `1px solid ${on ? 'var(--ink)' : 'var(--line2)'}`,
                    background: on ? 'var(--ink)' : 'transparent',
                    color: on ? 'var(--onInk)' : 'var(--ink)',
                    font: "500 12px 'Geist',sans-serif",
                    padding: '5px 11px',
                    borderRadius: 999,
                    cursor: 'pointer',
                  }}
                >
                  {formatGB(g)}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>{formatGB(0.5)}</span>
          <input
            type="range"
            min={0.5}
            max={32}
            step={0.5}
            value={s.storageLimitGB}
            onChange={e => saveSettings({ storageLimitGB: parseFloat(e.target.value) })}
            style={{ flex: 1 }}
          />
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>{formatGB(32)}</span>
          <span className="mono" style={{ font: "600 14px 'Geist Mono',monospace", minWidth: 56, textAlign: 'end' }}>
            {formatGB(s.storageLimitGB)}
          </span>
        </div>
      </Card>
      <Card style={{ marginTop: 10 }}>
        <SettingRow
          first
          title={tr('settings.manageDownloads')}
          sub={tr('settings.manageDownloadsSub')}
          right={<OutlineButton onClick={() => goTab('saving')}>{tr('desktop.open')}</OutlineButton>}
        />
      </Card>

      <SectionLabel>{tr('desktop.sectionLibrary')}</SectionLabel>
      <Card>
        <SettingRow
          first
          title={tr('settings.lookUpDetails')}
          sub={tr('settings.lookUpDetailsSub')}
          right={<Toggle on={s.fetchCoverArt} onChange={v => saveSettings({ fetchCoverArt: v })} />}
        />
        <SettingRow
          title={tr('settings.scan')}
          sub={tr('desktop.scanSub')}
          right={
            <OutlineButton onClick={scan} disabled={scanning}>
              {scanning && <Spinner size={12} />}
              {scanning ? tr('settings.scanning') : tr('desktop.scan')}
            </OutlineButton>
          }
        />
      </Card>

      <SectionLabel>{tr('settings.sectionSaving')}</SectionLabel>
      <Card>
        <SettingRow
          first
          title={tr('settings.saveWhileStreaming')}
          sub={tr('settings.saveWhileStreamingSub')}
          right={<Toggle on={s.saveWhileStreaming} onChange={v => saveSettings({ saveWhileStreaming: v })} />}
        />
      </Card>

      <SectionLabel>{tr('settings.sectionSources')}</SectionLabel>
      <Card>
        <SettingRow
          first
          title="YouTube"
          sub={s.youtubeBackend === 'device' ? tr('desktop.youtubeDeviceHint') : tr('settings.instanceHint', { onPhone: tr('desktop.youtubeDevice') })}
          right={
            <Segmented<YoutubeBackend>
              value={s.youtubeBackend}
              onChange={v => saveSettings({ youtubeBackend: v })}
              pad={12}
              options={[
                { value: 'device', label: tr('desktop.youtubeDevice') },
                { value: 'piped', label: 'Piped' },
                { value: 'invidious', label: 'Invidious' },
              ]}
            />
          }
        >
          {s.youtubeBackend !== 'device' && (
            <TextSetting
              label={tr('settings.instanceUrl')}
              value={s.youtubeInstance}
              placeholder="https://"
              onSave={v => saveSettings({ youtubeInstance: v })}
            />
          )}
        </SettingRow>
        <SettingRow title="Jamendo" sub={tr('settings.jamendoGet')}>
          <TextSetting
            label={tr('settings.jamendoClientId')}
            value={s.jamendoClientId}
            placeholder={tr('settings.jamendoPlaceholder')}
            onSave={v => saveSettings({ jamendoClientId: v.trim() })}
          />
        </SettingRow>
      </Card>

      <SectionLabel>{tr('settings.sectionListening')}</SectionLabel>
      <Card>
        <SettingRow
          first
          title={tr('settings.suggestSimilar')}
          sub={tr('settings.suggestSimilarSub')}
          right={<Toggle on={s.suggestSimilar} onChange={v => saveSettings({ suggestSimilar: v })} />}
        />
        <SettingRow
          title={tr('settings.playbackSpeed')}
          sub={tr('settings.playbackSpeedSub')}
          right={
            <OutlineButton mono onClick={() => openSheet({ kind: 'speed' })}>
              {speedLabel(s.playbackSpeed)}
            </OutlineButton>
          }
        />
        <SettingRow
          title={tr('settings.crossfade')}
          sub={s.crossfadeSeconds ? tr('settings.crossfadeOn', { count: s.crossfadeSeconds }) : tr('settings.crossfadeOff')}
          right={
            <span className="mono" style={{ font: "600 13px 'Geist Mono',monospace", flex: 'none' }}>
              {s.crossfadeSeconds ? tr('settings.seconds', { count: s.crossfadeSeconds }) : tr('common.off')}
            </span>
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>{tr('common.off')}</span>
            <input
              type="range"
              min={0}
              max={12}
              step={1}
              value={s.crossfadeSeconds}
              onChange={e => {
                const v = +e.target.value;
                saveSettings({ crossfadeSeconds: v === 1 ? 2 : v });
              }}
              style={{ flex: 1 }}
            />
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>{tr('settings.seconds', { count: 12 })}</span>
          </div>
        </SettingRow>
        <SettingRow
          title={tr('desktop.miniPlayer')}
          sub={tr('desktop.miniPlayerSub')}
          right={<Toggle on={s.floatingBubble} onChange={v => saveSettings({ floatingBubble: v })} />}
        />
        {s.floatingBubble && (
          <SettingRow title={tr('desktop.miniColour')} sub={tr(RING_NAME[s.bubbleRingColor])}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              {(Object.keys(RING_COLORS) as RingColor[]).map(k => {
                const on = s.bubbleRingColor === k;
                return (
                  <button
                    key={k}
                    aria-label={tr(RING_NAME[k])}
                    title={tr(RING_NAME[k])}
                    onClick={() => saveSettings({ bubbleRingColor: k })}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      border: 0,
                      padding: 0,
                      cursor: 'pointer',
                      background: k === 'cover' ? `conic-gradient(${pal.accent} 0 50%, ${pal.deep} 0)` : RING_COLORS[k],
                      boxShadow: on ? `0 0 0 2px var(--card), 0 0 0 4px ${ACCENT}` : 'inset 0 0 0 1px rgba(0,0,0,.15)',
                    }}
                  />
                );
              })}
            </div>
          </SettingRow>
        )}
        <SettingRow
          title={tr('settings.playerCover')}
          sub={s.playerArt === 'vinyl' ? tr('settings.playerCoverVinyl') : tr('settings.playerCoverSquare')}
          right={
            <Segmented
              value={s.playerArt}
              onChange={v => saveSettings({ playerArt: v })}
              options={[
                { value: 'vinyl', label: tr('settings.optVinyl') },
                { value: 'cover', label: tr('settings.optCover') },
              ]}
            />
          }
        />
        <SettingRow
          title={tr('settings.rotateArt')}
          sub={tr('settings.rotateArtSub')}
          right={<Toggle on={s.rotateArt} onChange={v => saveSettings({ rotateArt: v })} />}
        />
        <SettingRow title={tr('settings.vinylStyle')} sub={tr('desktop.vinylStyleSub')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, marginTop: 12 }}>
            {(['classic', 'colour', 'picture', 'clear'] as VinylStyle[]).map(k => {
              const on = s.vinylStyle === k;
              const label = tr(`sheets.vinyl${k[0].toUpperCase()}${k.slice(1)}` as Key);
              return (
                <button
                  key={k}
                  onClick={() => saveSettings({ vinylStyle: k, playerArt: 'vinyl' })}
                  style={{
                    border: `1.5px solid ${on ? ACCENT : 'var(--line)'}`,
                    background: on ? 'var(--fill2)' : 'transparent',
                    borderRadius: 14,
                    padding: '10px 4px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 7,
                    cursor: 'pointer',
                    color: 'var(--ink)',
                  }}
                >
                  <Vinyl src={previewArt} vinylStyle={k} deep={pal.deep} label={pal.artBg} spinning={false} size={44} small />
                  <span style={{ font: `${on ? 600 : 500} 12px 'Geist',sans-serif`, whiteSpace: 'nowrap' }}>{label}</span>
                </button>
              );
            })}
          </div>
        </SettingRow>
      </Card>

      <SectionLabel>{tr('desktop.sectionKaraoke')}</SectionLabel>
      <Card>
        <SettingRow
          first
          title={tr('desktop.voiceRemover')}
          sub={
            model.status === 'ready'
              ? tr('desktop.voiceRemoverReady', { name: MODEL.name, size: formatBytes(MODEL.bytes) })
              : tr('desktop.voiceRemoverMissing', { size: formatBytes(MODEL.bytes) })
          }
          right={
            model.status === 'ready' ? (
              <OutlineButton
                onClick={async () => {
                  await deleteModel();
                  toast(tr('desktop.voiceRemoverDeleted', { size: formatBytes(MODEL.bytes) }));
                }}
              >
                {tr('common.delete')}
              </OutlineButton>
            ) : undefined
          }
        />
        <SettingRow
          title={tr('karaoke.recordings')}
          sub={tr('desktop.recordingsIn', { count: recordings.length })}
          right={<OutlineButton onClick={() => goTab('saving')}>{tr('desktop.open')}</OutlineButton>}
        />
      </Card>

      <SectionLabel>{tr('settings.sectionAppearance')}</SectionLabel>
      <Card>
        <SettingRow
          first
          title={tr('settings.theme')}
          right={
            <Segmented
              value={s.theme}
              onChange={v => saveSettings({ theme: v })}
              options={[
                { value: 'light', label: tr('settings.themeLight') },
                { value: 'dark', label: tr('settings.themeDark') },
              ]}
            />
          }
        />
        <SettingRow
          title={tr('settings.playerBackground')}
          sub={tr('desktop.playerBackgroundSub')}
          right={
            <Segmented
              value={s.playerStyle}
              onChange={v => saveSettings({ playerStyle: v })}
              options={[
                { value: 'deep', label: tr('settings.bgDeep') },
                { value: 'light', label: tr('settings.bgLight') },
              ]}
            />
          }
        />
        <SettingRow
          title={tr('settings.songChange')}
          sub={tr(`settings.song${s.songChange[0].toUpperCase()}${s.songChange.slice(1)}Hint` as Key)}
          right={
            <Segmented<SongChange>
              value={s.songChange}
              onChange={v => saveSettings({ songChange: v })}
              pad={12}
              options={(['slide', 'fade', 'zoom', 'flip'] as SongChange[]).map(v => ({
                value: v,
                label: tr(`settings.song${v[0].toUpperCase()}${v.slice(1)}` as Key),
              }))}
            />
          }
        />
        <SettingRow
          title={tr('desktop.keepAwake')}
          sub={tr('desktop.keepAwakeSub')}
          right={<Toggle on={s.keepScreenOn} onChange={v => saveSettings({ keepScreenOn: v })} />}
        />
        <SettingRow
          title={tr('settings.language')}
          sub={tr('desktop.languageSub')}
          right={
            <OutlineButton onClick={() => openSheet({ kind: 'lang' })}>
              {langName ?? tr('desktop.systemLanguage', { name: LANGUAGES.find(l => l.code === navigator.language.slice(0, 2))?.name ?? 'English' })}
            </OutlineButton>
          }
        />
      </Card>
      {directionPending() && (
        <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 14, background: 'var(--accentSoft)', color: 'var(--accentInk)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, font: "500 13px/1.4 'Geist',sans-serif" }}>
            {tr('desktop.restartBanner', { name: langName ?? 'English' })}
          </div>
          <button
            onClick={() => relaunch()}
            style={{ border: 0, background: ACCENT, color: '#fff', font: "600 13px 'Geist',sans-serif", padding: '8px 12px', borderRadius: 999, cursor: 'pointer', flex: 'none' }}
          >
            {tr('desktop.restart')}
          </button>
        </div>
      )}

      <SectionLabel>{tr('desktop.sectionKeyboard')}</SectionLabel>
      <Card>
        {(
          [
            ['desktop.keyPlayPause', 'Space'],
            ['desktop.keySkip', 'Ctrl ← / →'],
            ['desktop.keyLyrics', 'L'],
            ['desktop.keyFull', 'F'],
            ['desktop.keySearch', 'Ctrl K'],
            ['desktop.keyEsc', 'Esc'],
          ] as Array<[Key, string]>
        ).map(([k, key], i) => (
          <SettingRow
            key={k}
            first={i === 0}
            title={tr(k)}
            right={
              <span className="mono" style={{ font: "600 12px 'Geist Mono',monospace", padding: '4px 9px', borderRadius: 6, border: '1px solid var(--line2)', color: 'var(--ink2)', flex: 'none' }}>
                {key}
              </span>
            }
          />
        ))}
      </Card>

      <SyncSettings />

      <SectionLabel>{tr('settings.sectionApp')}</SectionLabel>
      <Card>
        <SettingRow
          first
          title={tr('settings.checkUpdates')}
          sub={updatesSupported() ? tr('desktop.checkUpdatesSub') : tr('desktop.devBuild')}
          right={
            <OutlineButton onClick={check} disabled={checking || !updatesSupported()}>
              {checking && <Spinner size={12} />}
              {checking ? tr('settings.checking') : tr('settings.checkUpdates')}
            </OutlineButton>
          }
        />
      </Card>

      <div style={{ marginTop: 28, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Logo size={40} />
        <div>
          <div style={{ font: "700 17px 'Geist',sans-serif", letterSpacing: '-.03em' }}>stash</div>
          <div className="mono" style={{ font: "400 12px 'Geist Mono',monospace", color: 'var(--muted)' }}>
            {tr('desktop.version', { version: ver ? `${ver.name}${ver.debug ? ` · ${tr('settings.aboutDev')}` : ''}` : '…' })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TextSetting({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label style={{ display: 'block', marginTop: 12 }}>
      <div className="eyebrow" style={{ fontSize: 11, marginBottom: 6 }}>{label}</div>
      <input
        value={text}
        placeholder={placeholder}
        onChange={e => setText(e.target.value)}
        onBlur={() => text !== value && onSave(text)}
        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        style={{ width: '100%', height: 42, borderRadius: 12, border: '1px solid var(--line2)', padding: '0 14px', font: "400 14px 'Geist',sans-serif", outline: 0, background: 'var(--bg)', color: 'var(--ink)' }}
      />
    </label>
  );
}
