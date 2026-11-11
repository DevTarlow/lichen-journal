import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatLongDate } from '../lib/dates.js';
import { AlertIcon, CheckIcon, LockIcon, QuoteIcon, XIcon } from './Icons.jsx';

const MAX_ANSWER_LENGTH = 20_000;

export default function ReflectionAnswerModal({
  open,
  date,
  question,
  answer = '',
  mode = 'add',
  onSave,
  onClose
}) {
  const dialogRef = useRef(null);
  const textareaRef = useRef(null);
  const savingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [value, setValue] = useState(answer);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  savingRef.current = saving;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    setValue(answer);
    setError('');
    const previouslyFocused = document.activeElement;
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 40);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        onCloseRef.current(true);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], select, [tabindex]:not([tabindex="-1"])'
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
  }, [answer, open]);

  const canSave = Boolean(value.trim()) && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    savingRef.current = true;
    setError('');
    try {
      await onSave(value);
      onCloseRef.current(false);
    } catch (err) {
      setError(err && err.message ? err.message : 'The reflection could not be saved.');
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }, [canSave, onSave, value]);

  const dismiss = () => {
    if (!saving) onClose(true);
  };

  if (!open) return null;

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose(true);
      }}
    >
      <div
        className="settings-modal reflection-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reflection-answer-title"
        ref={dialogRef}
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow reflection-answer-eyebrow">
              <QuoteIcon size={12} />
              Reflection · {formatLongDate(date)}
            </p>
            <h2 id="reflection-answer-title">
              {mode === 'edit' ? 'Return to this question' : 'Sit with this question'}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={dismiss}
            aria-label="Close reflection box"
            disabled={saving}
          >
            <XIcon size={18} />
          </button>
        </header>

        <div className="modal-body">
          <blockquote id="reflection-answer-question" className="reflection-answer-question">
            {question}
          </blockquote>

          <label className="reflection-answer-label" htmlFor="reflection-answer">
            Your answer
          </label>
          <textarea
            id="reflection-answer"
            ref={textareaRef}
            className="reflection-answer-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                handleSave();
              }
            }}
            placeholder="Let the answer arrive slowly…"
            aria-describedby="reflection-answer-question reflection-answer-hint"
            maxLength={MAX_ANSWER_LENGTH}
            disabled={saving}
            spellCheck="true"
          />
          <div className="reflection-answer-meta" id="reflection-answer-hint">
            <span>{value.length.toLocaleString()} characters</span>
            <span>Saved only in your local vault.</span>
          </div>

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
            Never uploaded.
          </span>
          <div className="reflection-answer-actions">
            <button
              type="button"
              className="button button-quiet"
              onClick={dismiss}
              disabled={saving}
            >
              Not now
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={handleSave}
              disabled={!canSave}
            >
              {saving ? <span className="tiny-spinner" /> : <CheckIcon size={14} />}
              {saving ? 'Saving…' : mode === 'edit' ? 'Update reflection' : 'Save reflection'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
