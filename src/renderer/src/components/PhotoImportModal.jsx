import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatLongDate, todayISO } from '../lib/dates.js';
import { countWords } from '../lib/text.js';
import {
  AlertIcon,
  CheckIcon,
  LockIcon,
  PhotoIcon,
  XIcon
} from './Icons.jsx';

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function makeRequestId() {
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function PhotoImportModal({
  open,
  defaultDate,
  onClose,
  onAdd,
  onOpenSettings
}) {
  const dialogRef = useRef(null);
  const chooseRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const activeRequestRef = useRef(null);
  const savingRef = useRef(false);

  const [date, setDate] = useState(defaultDate || todayISO());
  const [existing, setExisting] = useState(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState('pick');
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [requestId, setRequestId] = useState('');

  onCloseRef.current = onClose;
  savingRef.current = saving;

  const reset = useCallback(
    (nextDate) => {
      setDate(nextDate || todayISO());
      setExisting(null);
      setStatus(null);
      setToken(null);
      setPhoto(null);
      setText('');
      setPhase('pick');
      setError('');
      setPicking(false);
      setSaving(false);
      setElapsed(0);
      setRequestId('');
    },
    []
  );

  useEffect(() => {
    if (!open) return undefined;
    reset(defaultDate || todayISO());
    const previouslyFocused = document.activeElement;
    const timer = window.setTimeout(() => chooseRef.current?.focus(), 40);

    api.ocr
      .status()
      .then((next) => setStatus(next))
      .catch(() => setStatus(null));

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        if (activeRequestRef.current) {
          api.ocr.cancel(activeRequestRef.current).catch(() => {});
          activeRequestRef.current = null;
        }
        onCloseRef.current();
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
      if (activeRequestRef.current) {
        const active = activeRequestRef.current;
        activeRequestRef.current = null;
        api.ocr.cancel(active).catch(() => {});
      }
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [defaultDate, open, reset]);

  useEffect(() => {
    if (!open) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setLoadingExisting(false);
      setExisting(null);
      return undefined;
    }
    let cancelled = false;
    setLoadingExisting(true);
    api.vault
      .get(date)
      .then((result) => {
        if (!cancelled) setExisting(result.entry || null);
      })
      .catch(() => {
        if (!cancelled) setExisting(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, open]);

  useEffect(() => {
    if (phase !== 'reading') return undefined;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const ocrReady = Boolean(
    status?.runtimePresent && status?.modelPresent && status?.projectorPresent
  );

  const choosePhoto = useCallback(async () => {
    if (picking) return;
    setPicking(true);
    setError('');
    try {
      const result = await api.ocr.pickImage();
      if (!result || result.canceled) return;
      setToken(result.token);
      setPhoto(result);
      setText('');
      setPhase('pick');
      setRequestId('');
    } catch (err) {
      setError(err.message || 'That photo could not be opened.');
    } finally {
      setPicking(false);
    }
  }, [picking]);

  const readPhoto = useCallback(async () => {
    if (!token || phase === 'reading' || !ocrReady) return;
    const id = makeRequestId();
    activeRequestRef.current = id;
    setRequestId(id);
    setPhase('reading');
    setError('');
    setElapsed(0);
    try {
      const result = await api.ocr.recognize(token, id);
      setText(result.text || '');
      setPhase('review');
    } catch (err) {
      if (err.code !== 'OCR_CANCELLED') {
        setError(err.message || 'The photo could not be read.');
      }
      setPhase('review');
    } finally {
      if (activeRequestRef.current === id) activeRequestRef.current = null;
    }
  }, [ocrReady, phase, token]);

  const cancelRead = useCallback(async () => {
    const id = requestId || activeRequestRef.current;
    if (!id) return;
    try {
      await api.ocr.cancel(id);
    } catch {
      // The request may already have finished.
    }
    activeRequestRef.current = null;
    setPhase('review');
  }, [requestId]);

  const savePage = useCallback(async () => {
    if (!dateValid || !text.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await onAdd({ date, text });
      onCloseRef.current();
    } catch (err) {
      setError(err.message || 'The page could not be saved.');
    } finally {
      setSaving(false);
    }
  }, [date, dateValid, onAdd, saving, text]);

  const dismiss = () => {
    if (saving) return;
    if (activeRequestRef.current) {
      api.ocr.cancel(activeRequestRef.current).catch(() => {});
      activeRequestRef.current = null;
    }
    onCloseRef.current();
  };

  if (!open) return null;

  const words = countWords(text);
  const hasExisting = Boolean(existing && String(existing.body || '').trim());
  const totalBytes = Number(photo?.bytes) || 0;
  const reading = phase === 'reading';
  const review = phase === 'review';

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) dismiss();
      }}
    >
      <div
        className="settings-modal photo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-import-title"
        ref={dialogRef}
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow">
              <PhotoIcon size={12} />
              Page from a photo
            </p>
            <h2 id="photo-import-title">Bring a page into the journal</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={dismiss}
            aria-label="Close photo import"
            disabled={saving}
          >
            <XIcon size={18} />
          </button>
        </header>

        <div className="modal-body photo-modal-body">
          <p className="settings-copy photo-intro">
            Choose a photo of a handwritten or printed page. MiniCPM-OCR reads it on
            this device. The photo itself is never uploaded or saved.
          </p>

          <div className="photo-date-row">
            <label className="photo-date-label" htmlFor="photo-date">
              Page date
            </label>
            <input
              id="photo-date"
              type="date"
              value={date}
              min="1900-01-01"
              max="2100-12-31"
              onChange={(event) => setDate(event.target.value)}
              disabled={reading || saving}
            />
            <span className="photo-date-note">
              {!dateValid
                ? 'Choose a day for this page.'
                : loadingExisting
                  ? 'Checking this day…'
                  : hasExisting
                    ? 'This day already has words. New text is added below them.'
                    : `A new page for ${formatLongDate(date)}.`}
            </span>
          </div>

          <div className="photo-stage">
            <div className={`photo-preview ${photo ? 'has-photo' : ''}`}>
              {photo ? (
                <>
                  <img src={photo.previewDataUrl} alt="Selected page preview" />
                  <div className="photo-file-meta">
                    <strong title={photo.fileName}>{photo.fileName}</strong>
                    <span>
                      {photo.width} × {photo.height} · {formatBytes(totalBytes)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="photo-placeholder">
                  <PhotoIcon size={34} />
                  <p>No photo chosen yet.</p>
                  <span>A clear, evenly lit page works best.</span>
                </div>
              )}
            </div>

            <div className="photo-controls">
              <button
                ref={chooseRef}
                type="button"
                className="button button-quiet"
                onClick={choosePhoto}
                disabled={picking || reading || saving}
              >
                <PhotoIcon size={15} />
                {picking ? 'Opening…' : photo ? 'Choose another photo' : 'Choose a photo'}
              </button>

              {!ocrReady ? (
                <div className="photo-warning" role="alert">
                  <AlertIcon size={16} />
                  <div>
                    <p>
                      The local OCR model is missing from this installation. You can
                      still type the page yourself, or check the paths in Settings.
                    </p>
                    <button
                      type="button"
                      className="text-button"
                      onClick={onOpenSettings}
                    >
                      Vault settings
                    </button>
                  </div>
                </div>
              ) : null}

              <p className="photo-privacy-note">
                <LockIcon size={12} />
                Read on this device. The photo is deleted from memory when you close
                this window.
              </p>
            </div>
          </div>

          {review || text || !ocrReady ? (
            <div className="photo-review">
              <div className="photo-review-head">
                <label htmlFor="photo-page-text">
                  {review ? 'Check the words before saving' : 'Page text'}
                </label>
                <span>
                  {words.toLocaleString()} {words === 1 ? 'word' : 'words'} ·{' '}
                  {text.length.toLocaleString()} characters
                </span>
              </div>
              <textarea
                id="photo-page-text"
                className="photo-text"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  if (phase === 'pick' && event.target.value.trim()) setPhase('review');
                }}
                placeholder={
                  ocrReady
                    ? 'The words from your photo will appear here. You can edit them.'
                    : 'You can type the page here.'
                }
                maxLength={200_000}
                disabled={reading || saving}
                spellCheck="true"
              />
              <p className="photo-review-hint">
                {hasExisting
                  ? 'These words will be added below the page that already exists for this day.'
                  : 'These words will become the page for this day.'}{' '}
                You can keep editing after it is added.
              </p>
            </div>
          ) : null}

          {reading ? (
            <div className="photo-reading" aria-live="polite">
              <span className="tiny-spinner" />
              <div>
                <strong>Reading the page on this device…</strong>
                <span>
                  {elapsed > 0 ? `${elapsed}s elapsed. ` : ''}
                  The first read takes a little longer while the model wakes.
                </span>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="reflection-answer-error" role="alert">
              <AlertIcon size={14} />
              {error}
            </p>
          ) : null}
        </div>

        <footer className="modal-foot photo-modal-foot">
          <span className="modal-foot-note">
            <LockIcon size={12} />
            Never uploaded, never trained on.
          </span>
          <div className="photo-actions">
            <button
              type="button"
              className="button button-quiet"
              onClick={dismiss}
              disabled={saving}
            >
              Cancel
            </button>
            {reading ? (
              <button type="button" className="button button-quiet" onClick={cancelRead}>
                <XIcon size={14} />
                Stop reading
              </button>
            ) : (
              <button
                type="button"
                className="button button-primary"
                onClick={review ? savePage : readPhoto}
                disabled={
                  saving ||
                  !dateValid ||
                  (review ? !text.trim() : !token || !ocrReady || reading)
                }
              >
                {saving ? (
                  <span className="tiny-spinner" />
                ) : review ? (
                  <CheckIcon size={14} />
                ) : (
                  <PhotoIcon size={14} />
                )}
                {saving
                  ? 'Adding…'
                  : review
                    ? 'Add to journal'
                    : 'Read this page'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
