import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatLongDate, formatTime, isToday, todayISO } from '../lib/dates.js';
import { ambientColors, paletteForEntry } from '../lib/palettes.js';
import { ritualProgress } from '../lib/ritual.js';
import { countWords } from '../lib/text.js';
import PageReflections from './PageReflections.jsx';
import {
  FeatherIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  LichenMark,
  LockIcon,
  PhotoIcon,
  RefreshIcon,
  TrashIcon
} from './Icons.jsx';

const TAGLINE =
  'Everything you write stays on your device. No subscriptions.';

const LEAVE_COVER_MS = 450;
const IDLE_COVER_MS = 4000;

function hoverCapable() {
  try {
    return window.matchMedia('(hover: hover)').matches;
  } catch {
    return true;
  }
}

function backSaveLabel(state, lastSavedAt) {
  if (state === 'saving') return 'Saving locally…';
  if (state === 'dirty') return 'Unsaved changes';
  if (state === 'error') return 'Couldn’t save — return to the page to retry';
  if (state === 'saved') {
    return lastSavedAt ? `Saved at ${formatTime(lastSavedAt)}` : 'Saved locally';
  }
  return 'Not saved yet';
}

function SaveIndicator({ state, lastSavedAt, onRetry }) {
  if (state === 'saving') {
    return (
      <span className="save-state is-saving">
        <span className="save-dot" />
        Saving locally…
      </span>
    );
  }
  if (state === 'dirty') {
    return (
      <span className="save-state is-dirty">
        <span className="save-dot" />
        Unsaved changes
      </span>
    );
  }
  if (state === 'error') {
    return (
      <button type="button" className="save-state is-error" onClick={onRetry}>
        <span className="save-dot" />
        Couldn&apos;t save — retry
        <RefreshIcon size={13} />
      </button>
    );
  }
  if (state === 'saved') {
    return (
      <span className="save-state is-saved">
        <span className="save-dot" />
        {lastSavedAt ? `Saved at ${formatTime(lastSavedAt)}` : 'Saved locally'}
      </span>
    );
  }
  return (
    <span className="save-state is-idle">
      <span className="save-dot" />
      Not saved yet
    </span>
  );
}

export default function Editor({
  selectedDate,
  draft,
  onTitleChange,
  onBodyChange,
  entry,
  saveState,
  lastSavedAt,
  onRetrySave,
  onReflect,
  onFinishPage,
  onReviewPage,
  aiBusy,
  finishActionRef,
  accentColor,
  titleInputRef,
  showFirstRun,
  onBeginWriting,
  onImportPhoto,
  shortcutLabel,
  pageTurn = true,
  onEditReflection,
  onDeletePage
}) {
  const [covered, setCovered] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
  const coverTimerRef = useRef(null);
  const idleTimerRef = useRef(null);
  const hoverCapableRef = useRef(true);

  const words = countWords(draft.body);
  const characters = draft.body.length;
  const palette = paletteForEntry(entry);
  const ambient = ambientColors(entry, accentColor);
  const hasAccent = Boolean(accentColor || (entry && entry.palette));
  const settled = Boolean(entry) && ritualProgress(entry).allDone;

  const clearTimers = useCallback(() => {
    if (coverTimerRef.current) {
      window.clearTimeout(coverTimerRef.current);
      coverTimerRef.current = null;
    }
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const reveal = useCallback(() => {
    clearTimers();
    setCovered(false);
  }, [clearTimers]);

  const coverNow = useCallback(() => {
    if (!pageTurn) return;
    clearTimers();
    setCovered(true);
  }, [clearTimers, pageTurn]);

  const scheduleLeaveCover = useCallback(() => {
    if (!pageTurn) return;
    clearTimers();
    coverTimerRef.current = window.setTimeout(() => {
      coverTimerRef.current = null;
      setCovered(true);
    }, LEAVE_COVER_MS);
  }, [clearTimers, pageTurn]);

  const scheduleIdleCover = useCallback(() => {
    if (!pageTurn) return;
    clearTimers();
    const elapsed = Date.now() - lastActivityRef.current;
    const delay = Math.max(0, IDLE_COVER_MS - elapsed);
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      setCovered(true);
    }, delay);
  }, [clearTimers, pageTurn]);

  useEffect(() => {
    hoverCapableRef.current = hoverCapable();
  }, []);

  useEffect(() => {
    const handleWindowBlur = () => coverNow();
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') coverNow();
    };
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [coverNow]);

  useEffect(() => {
    reveal();
  }, [selectedDate, reveal]);

  useEffect(() => {
    if (!pageTurn) reveal();
  }, [pageTurn, reveal]);

  useEffect(() => {
    if (showFirstRun) reveal();
  }, [showFirstRun, reveal]);

  useEffect(
    () => () => {
      clearTimers();
    },
    [clearTimers]
  );

  const handlePointerEnter = useCallback(() => {
    pointerInsideRef.current = true;
    lastActivityRef.current = Date.now();
    reveal();
  }, [reveal]);

  const handlePointerMove = useCallback(() => {
    if (covered) reveal();
  }, [covered, reveal]);

  const handlePointerLeave = useCallback(() => {
    pointerInsideRef.current = false;
    if (!hoverCapableRef.current) {
      if (focusInsideRef.current) scheduleIdleCover();
      return;
    }
    if (focusInsideRef.current) {
      scheduleIdleCover();
    } else {
      scheduleLeaveCover();
    }
  }, [scheduleIdleCover, scheduleLeaveCover]);

  const handlePointerDown = useCallback(() => {
    if (covered) reveal();
  }, [covered, reveal]);

  const handleFocus = useCallback(() => {
    focusInsideRef.current = true;
    lastActivityRef.current = Date.now();
    reveal();
  }, [reveal]);

  const handleBlur = useCallback(
    (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      focusInsideRef.current = false;
      if (!pointerInsideRef.current) scheduleLeaveCover();
    },
    [scheduleLeaveCover]
  );

  const handleKeyDown = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (covered) reveal();
    if (focusInsideRef.current && !pointerInsideRef.current) {
      scheduleIdleCover();
    }
  }, [covered, reveal, scheduleIdleCover]);

  const handleCompositionStart = useCallback(() => {
    lastActivityRef.current = Date.now();
    reveal();
  }, [reveal]);

  const canFinish = Boolean(draft.body.trim()) && !aiBusy && !preparing;
  const canReview = Boolean(draft.body.trim()) && !aiBusy;
  const finishTitle = !draft.body.trim()
    ? 'Write a few words first.'
    : aiBusy
      ? 'Wait for the companion to finish.'
      : 'Read this page and settle its mood, themes, and palette.';
  const reviewTitle = aiBusy
    ? 'Wait for the companion to finish.'
    : 'Open the final after-writing overview for this page.';

  const handleFinishPage = useCallback(async () => {
    if (!canFinish) return;
    setPreparing(true);
    try {
      await onFinishPage();
    } finally {
      setPreparing(false);
    }
  }, [canFinish, onFinishPage]);

  const handleReviewPage = useCallback(async () => {
    if (!canReview) return;
    await onReviewPage();
  }, [canReview, onReviewPage]);

  const style = {
    '--entry-accent': ambient[0],
    '--entry-accent-soft': ambient[1],
    '--entry-accent-wash': ambient[2]
  };

  return (
    <main
      className="editor-pane"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
    >
      <div className={`page-flip ${covered ? 'is-covered' : ''}`}>
        <div className="page-flip-inner">
          <div className="page-face page-front">
            <div className={`editor-card${hasAccent ? ' has-accent' : ''}`} style={style}>
              {showFirstRun ? (
                <section className="first-run" aria-label="Welcome to Lichen Journal">
                  <div className="first-run-mark">
                    <LichenMark size={48} />
                  </div>
                  <div className="first-run-copy">
                    <p className="eyebrow">A private place to begin</p>
                    <h2>A quiet place to notice what&apos;s alive in you.</h2>
                    <p>{TAGLINE}</p>
                  </div>
                  <div className="first-run-actions">
                    <button type="button" className="button button-primary" onClick={onBeginWriting}>
                      <FeatherIcon size={16} />
                      Begin today&apos;s entry
                    </button>
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={onImportPhoto}
                    >
                      <PhotoIcon size={16} />
                      Start from a photo
                    </button>
                  </div>
                </section>
              ) : null}

              <div className="editor-head">
                <div className="editor-date">
                  <p className="eyebrow">
                    {isToday(selectedDate) ? 'Today' : 'Journal'}
                    {palette ? <span className="editor-vibe">{palette.vibe_name}</span> : null}
                  </p>
                  <h2>{formatLongDate(selectedDate)}</h2>
                </div>
                <div className="editor-head-right">
                  <SaveIndicator state={saveState} lastSavedAt={lastSavedAt} onRetry={onRetrySave} />
                  <span className="shortcut-hint" title="Save now">
                    {shortcutLabel} S
                  </span>
                </div>
              </div>

              <input
                ref={titleInputRef}
                type="text"
                className="journal-title"
                value={draft.title}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="Give this day a name"
                aria-label="Entry title"
                maxLength={300}
                spellCheck="true"
              />

              <div className="editor-rule" aria-hidden="true" />

              <textarea
                className="journal-body"
                value={draft.body}
                onChange={(event) => onBodyChange(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    onReflect();
                  }
                }}
                placeholder="What's alive for you right now?"
                aria-label="Journal entry"
                spellCheck="true"
              />

              <PageReflections
                reflections={entry && Array.isArray(entry.reflections) ? entry.reflections : []}
                onEdit={onEditReflection}
              />

              <div className="editor-foot">
                <div className="editor-foot-left">
                  {entry ? (
                    <button
                      type="button"
                      className="button button-quiet button-small delete-page"
                      onClick={onDeletePage}
                      title="Delete this page from your local vault"
                    >
                      <TrashIcon size={14} />
                      Delete page
                    </button>
                  ) : null}
                  <div className="editor-counts" aria-live="polite">
                    <span>{words.toLocaleString()} words</span>
                    <span className="dot-separator" aria-hidden="true">
                      ·
                    </span>
                    <span>{characters.toLocaleString()} characters</span>
                    {selectedDate === todayISO() ? (
                      <span className="local-mark">
                        <span className="live-dot" aria-hidden="true" />
                        local draft
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="editor-foot-actions">
                  {settled ? (
                    <div className="finish-actions">
                      <span
                        className="finish-status"
                        title="Mood, themes, and palette are complete for this page."
                      >
                        <CheckIcon size={14} />
                        Page finished
                      </span>
                      <button
                        ref={finishActionRef}
                        type="button"
                        className="button button-quiet button-small review-page"
                        onClick={handleReviewPage}
                        disabled={!canReview}
                        title={reviewTitle}
                      >
                        <BookOpenIcon size={14} />
                        Review
                      </button>
                    </div>
                  ) : (
                    <button
                      ref={finishActionRef}
                      type="button"
                      className="button button-primary button-small finish-page"
                      onClick={handleFinishPage}
                      disabled={!canFinish}
                      title={finishTitle}
                    >
                      {preparing ? <span className="tiny-spinner" /> : <ArrowRightIcon size={14} />}
                      {preparing ? 'Preparing…' : 'Finish page'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="page-face page-back" aria-hidden="true">
            <div className="editor-card editor-card-back">
              <div className="page-back-top">
                <p className="eyebrow">
                  <LockIcon size={12} />
                  Private page
                </p>
              </div>

              <div className="page-back-main">
                <LichenMark size={52} className="page-back-mark" />
                <p className="page-back-date">{formatLongDate(selectedDate)}</p>
                <p className="page-back-quote">“This page is resting.”</p>
                <p className="page-back-hint">
                  Move your pointer here, or focus the page, to turn it back.
                </p>
              </div>

              <p className={`page-back-save save-state is-${saveState || 'idle'}`}>
                <span className="save-dot" />
                {backSaveLabel(saveState, lastSavedAt)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
