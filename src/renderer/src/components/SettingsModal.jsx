import React, { useEffect, useRef, useState } from 'react';
import { THEME_PALETTES } from '../lib/preferences.js';
import { backendLabel } from '../lib/compute.js';
import ModelAssetList from './ModelAssetList.jsx';
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  CpuIcon,
  DownloadIcon,
  FolderIcon,
  InfoIcon,
  LockIcon,
  PaletteIcon,
  PhotoIcon,
  RefreshIcon,
  ShieldIcon,
  TrashIcon,
  XIcon
} from './Icons.jsx';

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function PathRow({ label, value, onCopy }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await onCopy(value);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="path-row">
      <span className="path-label">{label}</span>
      <div className="path-value">
        <code title={value || ''}>{value || 'Unavailable'}</code>
        <button
          type="button"
          className="icon-button icon-button-small"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
          title="Copy path"
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        </button>
      </div>
    </div>
  );
}

export default function SettingsModal({
  open,
  onClose,
  info,
  theme,
  preferences,
  onPreferencesChange,
  aiStatus,
  aiBusy,
  modelStatus,
  compute,
  computeBusy,
  onUseCpu,
  onTestGpu,
  onDownloadAsset,
  onCancelModel,
  onImportModelFile,
  onImportModelFolder,
  onCopy,
  onOpenFolder,
  onExport,
  onPurge,
  onOfflineCheck,
  onReloadModel
}) {
  const dialogRef = useRef(null);
  const busyRef = useRef(false);
  const purgeStepRef = useRef(0);
  const onCloseRef = useRef(onClose);
  const [purgeStep, setPurgeStep] = useState(0);
  const [purgeText, setPurgeText] = useState('');
  const [purging, setPurging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState('');
  const [offlineResult, setOfflineResult] = useState(null);
  const [checkingOffline, setCheckingOffline] = useState(false);
  const [purgeError, setPurgeError] = useState('');
  const [exportError, setExportError] = useState('');
  const [computeError, setComputeError] = useState('');

  busyRef.current = purging || exporting;
  purgeStepRef.current = purgeStep;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    setPurgeStep(0);
    setPurgeText('');
    setOfflineResult(null);
    setLastExport('');
    setPurgeError('');
    setExportError('');
    setComputeError('');
    const previouslyFocused = document.activeElement;
    const timer = window.setTimeout(() => {
      const first = dialogRef.current?.querySelector('button, input, [tabindex="0"]');
      if (first) first.focus();
    }, 40);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        if (purgeStepRef.current === 1) {
          setPurgeStep(0);
          setPurgeText('');
        } else {
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const stats = info?.stats;
  const modelBytes = aiStatus?.modelBytes ?? info?.modelBytes;
  const accelNoun = compute?.noun === 'graphics chip' ? 'graphics chip' : 'video card';

  const handleCopy = async (value) => {
    if (!value) return false;
    try {
      await onCopy(value);
      return true;
    } catch {
      return false;
    }
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const result = await onExport();
      if (result && !result.canceled) {
        setLastExport(result.filePath || '');
      }
    } catch (error) {
      setExportError(error.message);
    } finally {
      setExporting(false);
    }
  };

  const handlePurge = async () => {
    if (purgeText !== 'PURGE' || purging) return;
    setPurging(true);
    setPurgeError('');
    try {
      await onPurge();
      onCloseRef.current();
    } catch (error) {
      setPurgeError(error.message);
    } finally {
      setPurging(false);
    }
  };

  const handleOfflineCheck = async () => {
    if (checkingOffline) return;
    setCheckingOffline(true);
    setOfflineResult(null);
    try {
      const result = await onOfflineCheck();
      setOfflineResult(result);
    } catch (error) {
      setOfflineResult({ blocked: true, detail: error.message });
    } finally {
      setCheckingOffline(false);
    }
  };

  const handleComputeToggle = async (event) => {
    const wantsGpu = event.target.checked;
    setComputeError('');
    const result = wantsGpu ? await onTestGpu() : await onUseCpu();
    if (!result || result.ok !== true) {
      setComputeError(result?.message || 'The performance setting could not be changed.');
    }
  };

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !purging && !exporting) onClose();
      }}
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        ref={dialogRef}
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow">Your data, under your roof</p>
            <h2 id="settings-title">Vault settings</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close vault settings"
            disabled={purging}
          >
            <XIcon size={18} />
          </button>
        </header>

        <div className="modal-body">
          <section className="settings-section" aria-labelledby="preferences-heading">
            <div className="settings-section-head">
              <h3 id="preferences-heading">
                <PaletteIcon size={15} />
                Preferences
              </h3>
            </div>
            <p className="settings-copy">
              Small choices that make the room feel like yours. They stay on this device.
            </p>

            <div className="preference-group">
              <span className="preference-label">Theme colors</span>
              <p className="preference-hint">
                Tints the paper, buttons, and soft glow in both light and dark mode.
              </p>
              <div className="palette-options" role="group" aria-label="Theme color palette">
                {THEME_PALETTES.map((option) => {
                  const selected = (preferences?.palette || 'lichen') === option.id;
                  const swatches = theme === 'dark' ? option.darkSwatches : option.swatches;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`palette-option ${selected ? 'is-selected' : ''}`}
                      onClick={() => onPreferencesChange?.({ palette: option.id })}
                      aria-pressed={selected}
                    >
                      <span className="palette-option-dots" aria-hidden="true">
                        {swatches.map((color) => (
                          <span key={color} style={{ background: color }} />
                        ))}
                      </span>
                      <span className="palette-option-copy">
                        <strong>{option.name}</strong>
                        <span>{option.hint}</span>
                      </span>
                      {selected ? <CheckIcon size={13} className="palette-option-check" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="preference-toggle" htmlFor="pref-page-turn">
              <span className="preference-text">
                <span className="preference-label">Flip the page when you step away</span>
                <span className="preference-hint">
                  Covers the entry when the pointer leaves, the window loses focus, or you pause.
                  This is a visual cover, not encryption or a password lock.
                </span>
              </span>
              <span className="switch">
                <input
                  id="pref-page-turn"
                  type="checkbox"
                  checked={preferences?.pageTurn !== false}
                  onChange={(event) => onPreferencesChange?.({ pageTurn: event.target.checked })}
                />
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
              </span>
            </label>

            <label className="preference-toggle" htmlFor="pref-reduce-motion">
              <span className="preference-text">
                <span className="preference-label">Reduce motion</span>
                <span className="preference-hint">
                  Turns off the page-turn and fade animations, including loading spinners.
                </span>
              </span>
              <span className="switch">
                <input
                  id="pref-reduce-motion"
                  type="checkbox"
                  checked={Boolean(preferences?.reduceMotion)}
                  onChange={(event) => onPreferencesChange?.({ reduceMotion: event.target.checked })}
                />
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
              </span>
            </label>

            {compute?.canChooseGpu && compute?.modelPresent ? (
              <>
                <label className="preference-toggle" htmlFor="pref-video-card">
                  <span className="preference-text">
                    <span className="preference-label">
                      Faster answers with my {accelNoun}
                    </span>
                    <span className="preference-hint">
                      Lets the companion and photo reader use your {accelNoun}. We&apos;ll
                      check it before turning it on. Off keeps everything on the processor.
                    </span>
                  </span>
                  <span className="switch">
                    <input
                      id="pref-video-card"
                      type="checkbox"
                      checked={compute.mode === 'gpu' || Boolean(computeBusy)}
                      disabled={Boolean(computeBusy) || Boolean(aiBusy)}
                      onChange={handleComputeToggle}
                    />
                    <span className="switch-track" aria-hidden="true">
                      <span className="switch-thumb" />
                    </span>
                  </span>
                </label>
                <p className="settings-fineprint compute-fineprint" aria-live="polite">
                  {computeBusy
                    ? `Checking your ${accelNoun}…`
                    : compute.mode === 'gpu'
                      ? `Using your ${accelNoun}.`
                      : computeError ||
                        compute.lastError?.message ||
                        'Using the processor.'}
                </p>
              </>
            ) : null}
          </section>

          <section className="settings-section" aria-labelledby="storage-heading">
            <div className="settings-section-head">
              <h3 id="storage-heading">
                <FolderIcon size={15} />
                Storage
              </h3>
              <button type="button" className="button button-quiet button-small" onClick={onOpenFolder}>
                <FolderIcon size={13} />
                Open folder
              </button>
            </div>
            <p className="settings-copy">
              Everything lives in one SQLite file on this machine. Portable, inspectable, and
              entirely yours.
            </p>
            <PathRow label="Vault database" value={info?.dbPath} onCopy={handleCopy} />
            <PathRow label="Vault folder" value={info?.vaultDir} onCopy={handleCopy} />
            <PathRow label="Application data" value={info?.userDataPath} onCopy={handleCopy} />
            <div className="stat-grid">
              <div>
                <span>Entries</span>
                <strong>{stats?.entryCount ?? '—'}</strong>
              </div>
              <div>
                <span>Words</span>
                <strong>{(stats?.wordCount || 0).toLocaleString()}</strong>
              </div>
              <div>
                <span>Vault size</span>
                <strong>{formatBytes(stats?.vaultBytes ?? stats?.dbBytes)}</strong>
              </div>
              <div>
                <span>Schema</span>
                <strong>v{stats?.schemaVersion ?? 1}</strong>
              </div>
            </div>
            <p className="settings-fineprint">
              Local files are not encrypted by Lichen Journal. Anyone with access to your operating
              system account can read this vault. Use your device&apos;s disk encryption.
            </p>
          </section>

          <section className="settings-section" aria-labelledby="companion-heading">
            <div className="settings-section-head">
              <h3 id="companion-heading">
                <CpuIcon size={15} />
                Local companion
              </h3>
              <button
                type="button"
                className="button button-quiet button-small"
                onClick={onReloadModel}
                disabled={Boolean(aiBusy) || !aiStatus?.modelPresent}
              >
                <RefreshIcon size={13} />
                {aiBusy === 'model' ? 'Waking…' : 'Reload model'}
              </button>
            </div>
            <p className="settings-copy">
              MiniCPM-V 4.7 1B Instruct, downloaded once from Hugging Face and then
              run from a local GGUF file. It uses the processor by default; the
              video card switch in Preferences can use your {accelNoun} for faster answers.
            </p>
            <PathRow label="Model file" value={aiStatus?.modelPath || info?.modelPath} onCopy={handleCopy} />
            <ModelAssetList
              status={modelStatus}
              assetIds={['companion']}
              onDownload={onDownloadAsset}
              onCancel={onCancelModel}
              onImportFile={onImportModelFile}
              compact
            />
            <div className="model-facts">
              <span className={`status-pill ${aiStatus?.modelPresent ? 'is-ok' : 'is-warn'}`}>
                {aiStatus?.modelPresent ? 'Model present' : 'Model missing'}
              </span>
              <span className="status-pill">{formatBytes(modelBytes)}</span>
              <span className="status-pill">
                {aiStatus?.state === 'ready'
                  ? `${backendLabel(aiStatus.backend)} · ${aiStatus.threads} threads`
                  : String(aiStatus?.state || 'idle').toUpperCase()}
              </span>
            </div>
          </section>

          <section className="settings-section" aria-labelledby="ocr-heading">
            <div className="settings-section-head">
              <h3 id="ocr-heading">
                <PhotoIcon size={15} />
                Photo pages
              </h3>
            </div>
            <p className="settings-copy">
              MiniCPM-OCR 1.0 Q4_K_M reads photos of pages with a 4× vision
              projector. The model and projector are downloaded once; the local
              runtime ships with the app. Photo reading uses the same video-card
              preference and falls back to the processor automatically. The photo
              itself is never stored.
            </p>
            <PathRow label="OCR model" value={info?.ocrModelPath} onCopy={handleCopy} />
            <PathRow
              label="Photo reader support"
              value={info?.ocrProjectorPath}
              onCopy={handleCopy}
            />
            <PathRow label="OCR runtime" value={info?.ocrRuntimePath} onCopy={handleCopy} />
            <ModelAssetList
              status={modelStatus}
              assetIds={['ocrModel', 'ocrProjector']}
              onDownload={onDownloadAsset}
              onCancel={onCancelModel}
              onImportFile={onImportModelFile}
              compact
            />
            <button
              type="button"
              className="text-button"
              onClick={() => onImportModelFolder?.()}
              disabled={Boolean(modelStatus?.busy)}
            >
              Use a folder of model files
            </button>
            <p className="settings-fineprint">
              Photo pages work entirely offline after setup. If a file is missing,
              journaling and the companion still work; download it here when you are
              ready.
            </p>
          </section>

          <section className="settings-section" aria-labelledby="security-heading">
            <div className="settings-section-head">
              <h3 id="security-heading">
                <ShieldIcon size={15} />
                Offline by design
              </h3>
              <button
                type="button"
                className="button button-quiet button-small"
                onClick={handleOfflineCheck}
                disabled={checkingOffline}
              >
                {checkingOffline ? <span className="tiny-spinner" /> : <LockIcon size={13} />}
                {checkingOffline ? 'Checking…' : 'Verify offline'}
              </button>
            </div>
            <ul className="security-list">
              <li>The renderer cannot reach HTTP, HTTPS, WebSocket, or DNS traffic.</li>
              <li>No accounts, analytics, crash reporting, sync, or auto-update channels.</li>
              <li>Model weights download only when you press a download button; after setup, no network is used.</li>
              <li>The interface loads no remote fonts, images, or scripts.</li>
            </ul>
            <button type="button" className="button button-primary button-small" onClick={handleOfflineCheck} disabled={checkingOffline}>
              <LockIcon size={13} />
              {checkingOffline ? 'Running local check…' : 'Run air-gap self-check'}
            </button>
            {offlineResult ? (
              <p className={`offline-result ${offlineResult.blocked ? 'is-blocked' : 'is-open'}`}>
                {offlineResult.blocked ? <CheckIcon size={14} /> : <AlertIcon size={14} />}
                {offlineResult.blocked
                  ? 'Blocked. The probe could not reach the network.'
                  : 'Unexpected: a network probe completed. Do not trust this build.'}
              </p>
            ) : null}
          </section>

          <section className="settings-section" aria-labelledby="export-heading">
            <div className="settings-section-head">
              <h3 id="export-heading">
                <DownloadIcon size={15} />
                Export
              </h3>
            </div>
            <p className="settings-copy">
              Bundle every entry into a ZIP of clean Markdown files plus a complete{' '}
              <code>metadata.json</code>.
            </p>
            <div className="settings-action-row">
              <button
                type="button"
                className="button button-primary"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? <span className="tiny-spinner" /> : <DownloadIcon size={15} />}
                {exporting ? 'Preparing ZIP…' : 'Export vault to ZIP'}
              </button>
              {lastExport ? <span className="export-path" title={lastExport}>{lastExport}</span> : null}
            {exportError ? <span className="error-line">{exportError}</span> : null}
            </div>
          </section>

          <section className="settings-section danger-section" aria-labelledby="danger-heading">
            <div className="settings-section-head">
              <h3 id="danger-heading">
                <TrashIcon size={15} />
                Clear all vault data
              </h3>
            </div>
            {purgeStep === 0 ? (
              <>
                <p className="settings-copy">
                  This permanently removes every entry, tag, reflection, and palette from this
                  device. Export a copy first if there is any chance you want it.
                </p>
                <button type="button" className="button button-danger" onClick={() => setPurgeStep(1)}>
                  <TrashIcon size={14} />
                  Clear all vault data…
                </button>
              </>
            ) : (
              <div className="purge-confirm" role="alert">
                <div className="purge-warning">
                  <AlertIcon size={18} />
                  <div>
                    <strong>
                      Delete {stats?.entryCount ?? 0} {(stats?.entryCount ?? 0) === 1 ? 'entry' : 'entries'} forever?
                    </strong>
                    <p>
                      The database file will be removed from disk and a fresh empty vault will be
                      created. This cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="purge-actions">
                  <button
                    type="button"
                    className="button button-quiet button-small"
                    onClick={handleExport}
                    disabled={exporting || purging}
                  >
                    <DownloadIcon size={13} />
                    Export first
                  </button>
                  <button
                    type="button"
                    className="button button-quiet button-small"
                    onClick={() => {
                      setPurgeStep(0);
                      setPurgeText('');
                    }}
                    disabled={purging}
                  >
                    Cancel
                  </button>
                </div>
                <label className="purge-label" htmlFor="purge-confirmation">
                  Type <strong>PURGE</strong> to confirm
                </label>
                <input
                  id="purge-confirmation"
                  className="purge-input"
                  value={purgeText}
                  onChange={(event) => setPurgeText(event.target.value)}
                  placeholder="PURGE"
                  autoComplete="off"
                  spellCheck="false"
                  disabled={purging}
                />
                <button
                  type="button"
                  className="button button-danger"
                  onClick={handlePurge}
                  disabled={purgeText !== 'PURGE' || purging}
                >
                  {purging ? <span className="tiny-spinner" /> : <TrashIcon size={14} />}
                  {purging ? 'Clearing the vault…' : 'Permanently clear vault'}
                </button>
                {purgeError ? <p className="offline-result is-open">{purgeError}</p> : null}
              </div>
            )}
          </section>

          <section className="settings-section about-section" aria-labelledby="about-heading">
            <div className="settings-section-head">
              <h3 id="about-heading">
                <InfoIcon size={15} />
                About
              </h3>
            </div>
            <p className="about-tagline">
              Lichen Journal · Private daily writing. Everything you write stays on your
              device. No subscriptions.
            </p>
            <div className="about-grid">
              <span>Version</span>
              <strong>{info?.appVersion || '—'}</strong>
              <span>Electron</span>
              <strong>{info?.electron || '—'}</strong>
              <span>Platform</span>
              <strong>{info ? `${info.platform} ${info.arch}` : '—'}</strong>
              <span>Distribution</span>
              <strong>GitHub · GPLv3</strong>
            </div>
          </section>
        </div>

        <footer className="modal-foot">
          <span className="modal-foot-note">
            <LockIcon size={12} />
            No cloud. No account. No telemetry.
          </span>
          <button type="button" className="button button-quiet" onClick={onClose} disabled={purging}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
