import React, { useCallback, useEffect, useRef, useState } from 'react';
import ModelAssetList from './ModelAssetList.jsx';
import { AlertIcon, LockIcon, XIcon } from './Icons.jsx';

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ModelSetupModal({
  open,
  status,
  onClose,
  onDownloadAll,
  onDownload,
  onCancel,
  onImportFolder,
  onImportFile
}) {
  const dialogRef = useRef(null);
  const primaryRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeRef = useRef(null);
  const [actionError, setActionError] = useState('');

  const busy = Boolean(status?.busy || status?.downloading);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    setActionError('');
    const previouslyFocused = document.activeElement;
    const timer = window.setTimeout(() => primaryRef.current?.focus(), 40);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (closeRef.current) closeRef.current();
        else onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
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

  const run = useCallback(async (operation) => {
    setActionError('');
    try {
      return await operation();
    } catch (error) {
      setActionError(error.message || 'The model files could not be prepared.');
      return null;
    }
  }, []);

  const close = useCallback(async () => {
    if (busy && onCancel) {
      try {
        await onCancel();
      } catch {
        // Closing must not be blocked by a cancellation failure.
      }
    }
    onCloseRef.current();
  }, [busy, onCancel]);
  closeRef.current = close;

  if (!open) return null;

  const assets = status?.assets ? Object.values(status.assets) : [];
  const missing = assets.filter((asset) => asset.state !== 'ready');
  const progress = Math.max(0, Math.min(100, Number(status?.progress) || 0));
  const allReady = Boolean(status?.allReady);

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="settings-modal model-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-setup-title"
        ref={dialogRef}
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow">First-run setup</p>
            <h2 id="model-setup-title">
              {allReady ? 'The local models are ready.' : 'Set up the local model files'}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close model setup"
          >
            <XIcon size={18} />
          </button>
        </header>

        <div className="modal-body model-setup-body">
          {!status ? (
            <p className="model-assets-loading" aria-live="polite">
              Checking model files…
            </p>
          ) : allReady ? (
            <div className="model-setup-ready" role="status">
              <strong>Everything is installed.</strong>
              <p>Reflections and photo pages now run entirely on this machine.</p>
            </div>
          ) : (
            <>
              <p className="settings-copy model-setup-intro">
                Lichen Journal does not bundle its model weights. Download them once
                from Hugging Face, then the app works without a network connection.
              </p>
              <div className="model-setup-summary">
                <span>
                  {formatBytes(status?.downloadedBytes || 0)} of{' '}
                  {formatBytes(status?.totalBytes || 0)}
                </span>
                <strong>{progress}%</strong>
              </div>
              <div
                className="model-progress-track model-setup-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-label="Overall model download progress"
              >
                <span style={{ width: `${Math.max(2, progress)}%` }} />
              </div>
              <ModelAssetList
                status={status}
                onDownload={(assetId) => run(() => onDownload(assetId))}
                onCancel={onCancel}
                onImportFile={(assetId) => run(() => onImportFile(assetId))}
                disabled={busy}
              />
              <p className="model-setup-skip-note">
                You can skip this and still write, search, export, and keep your
                journal. Reflections and photo pages will offer the download again
                in Settings.
              </p>
            </>
          )}

          {actionError ? (
            <p className="reflection-answer-error" role="alert">
              <AlertIcon size={14} />
              {actionError}
            </p>
          ) : null}
        </div>

        <footer className="modal-foot model-setup-foot">
          <span className="modal-foot-note">
            <LockIcon size={12} />
            Downloaded once, verified locally.
          </span>
          <div className="model-setup-actions">
            <button
              type="button"
              className="text-button"
              onClick={() =>
                run(async () => {
                  const result = await onImportFolder();
                  if (result && !result.canceled && !result.imported?.length) {
                    setActionError(
                      'No matching model files were found in that folder. Choose the folder containing the three GGUF files.'
                    );
                  } else if (result?.failed?.length) {
                    setActionError('Some files did not match the expected model or could not be imported.');
                  }
                })
              }
              disabled={busy}
            >
              Use files I already have
            </button>
            <button type="button" className="button button-quiet" onClick={close}>
              {busy ? 'Cancel download' : allReady ? 'Done' : 'Not now'}
            </button>
            {!allReady ? (
              <button
                ref={primaryRef}
                type="button"
                className="button button-primary"
                onClick={() => run(() => onDownloadAll())}
                disabled={busy || !missing.length}
              >
                {busy ? 'Downloading…' : 'Download missing files'}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
