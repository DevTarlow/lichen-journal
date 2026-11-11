import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertIcon, LockIcon, TrashIcon, XIcon } from './Icons.jsx';

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function ResetAppModal({
  open,
  mode,
  entryCount = 0,
  modelDir = '',
  modelBytes = 0,
  onConfirm,
  onClose
}) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const resettingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');

  resettingRef.current = resetting;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    setError('');
    const previouslyFocused = document.activeElement;
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 40);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !resettingRef.current) {
        event.preventDefault();
        onCloseRef.current();
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

  const handleConfirm = useCallback(async () => {
    if (resettingRef.current) return;
    setResetting(true);
    resettingRef.current = true;
    setError('');
    try {
      await onConfirm();
    } catch (err) {
      setError(err && err.message ? err.message : 'The app could not be reset.');
      setResetting(false);
      resettingRef.current = false;
    }
  }, [onConfirm]);

  if (!open) return null;

  const isFresh = mode === 'fresh';
  const entries = Number(entryCount) || 0;
  const entryLabel = `${entries} ${entries === 1 ? 'entry' : 'entries'}`;
  const hasModels = Number(modelBytes) > 0;
  const title = isFresh ? 'Reset the app?' : 'Reset and load mock data?';
  const confirmLabel = isFresh ? 'Reset everything' : 'Reset and load mock data';

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !resetting) onClose();
      }}
    >
      <div
        className="settings-modal reset-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-app-title"
        ref={dialogRef}
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow">Developer tool · not in packaged builds</p>
            <h2 id="reset-app-title">{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              if (!resetting) onClose();
            }}
            aria-label="Close reset confirmation"
            disabled={resetting}
          >
            <XIcon size={18} />
          </button>
        </header>

        <div className="modal-body reset-modal-body">
          <div className="purge-warning" role="alert">
            <AlertIcon size={18} />
            <div>
              <strong>
                {isFresh ? `Delete ${entryLabel} and start over?` : `Delete ${entryLabel} and load the demo journal?`}
              </strong>
              <p>
                {isFresh
                  ? 'This removes every journal entry, your theme and preferences, the saved compute setting, and the downloaded model files. Model setup will appear on the next screen.'
                  : 'This removes every journal entry and your theme and preferences, then adds eight example entries. Downloaded models and the saved compute setting stay on disk.'}
              </p>
            </div>
          </div>

          {isFresh && hasModels ? (
            <p className="reset-modal-detail">
              Downloading these again: <strong>{formatBytes(modelBytes)}</strong>
              {modelDir ? (
                <>
                  {' '}in <code>{modelDir}</code>
                </>
              ) : null}
              .
            </p>
          ) : null}
          {!isFresh && hasModels ? (
            <p className="reset-modal-detail">
              Keeping <strong>{formatBytes(modelBytes)}</strong> of downloaded models
              {modelDir ? (
                <>
                  {' '}in <code>{modelDir}</code>
                </>
              ) : null}
              .
            </p>
          ) : null}

          {error ? (
            <p className="reflection-answer-error" role="alert">
              <AlertIcon size={14} />
              {error}
            </p>
          ) : null}
        </div>

        <footer className="modal-foot">
          <span className="modal-foot-note">
            <LockIcon size={12} />
            Local development only.
          </span>
          <div className="delete-modal-actions">
            <button
              ref={cancelRef}
              type="button"
              className="button button-quiet"
              onClick={() => {
                if (!resetting) onClose();
              }}
              disabled={resetting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={handleConfirm}
              disabled={resetting}
            >
              {resetting ? <span className="tiny-spinner" /> : <TrashIcon size={14} />}
              {resetting ? 'Resetting…' : confirmLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
