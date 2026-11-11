import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatLongDate } from '../lib/dates.js';
import { AlertIcon, LockIcon, TrashIcon, XIcon } from './Icons.jsx';

export default function DeletePageModal({ open, date, title, onConfirm, onClose }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const deletingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  deletingRef.current = deleting;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    setError('');
    const previouslyFocused = document.activeElement;
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 40);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !deletingRef.current) {
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
    if (deletingRef.current) return;
    setDeleting(true);
    deletingRef.current = true;
    setError('');
    try {
      await onConfirm();
      onCloseRef.current();
    } catch (err) {
      setError(err && err.message ? err.message : 'The page could not be deleted.');
    } finally {
      setDeleting(false);
      deletingRef.current = false;
    }
  }, [onConfirm]);

  const dismiss = () => {
    if (!deleting) onClose();
  };

  if (!open) return null;

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onClose();
      }}
    >
      <div
        className="settings-modal delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-page-title"
        ref={dialogRef}
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow">{formatLongDate(date)}</p>
            <h2 id="delete-page-title">Delete this page?</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={dismiss}
            aria-label="Close delete confirmation"
            disabled={deleting}
          >
            <XIcon size={18} />
          </button>
        </header>

        <div className="modal-body delete-modal-body">
          <p className="delete-page-name">{String(title || '').trim() || 'Untitled page'}</p>
          <p className="delete-page-copy">
            This removes the entry, its tags, palette, and saved reflections from your local
            vault. This cannot be undone.
          </p>
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
            Saved only on this device.
          </span>
          <div className="delete-modal-actions">
            <button
              ref={cancelRef}
              type="button"
              className="button button-quiet"
              onClick={dismiss}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={handleConfirm}
              disabled={deleting}
            >
              {deleting ? <span className="tiny-spinner" /> : <TrashIcon size={14} />}
              {deleting ? 'Deleting…' : 'Delete page'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
