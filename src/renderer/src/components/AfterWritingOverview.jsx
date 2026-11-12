import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatLongDate } from '../lib/dates.js';
import { fallbackPalette, moodLabel, paletteForEntry } from '../lib/palettes.js';
import { RITUAL_STEPS, ritualProgress } from '../lib/ritual.js';
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  LeafIcon,
  LichenMark,
  PaletteIcon,
  RefreshIcon,
  SparkleIcon,
  TagIcon
} from './Icons.jsx';

const STAGES = [...RITUAL_STEPS, { key: 'overview', label: 'Overview' }];
const STAGE_PROGRESS = { idle: 0, reading: 0, mood: 0, themes: 1, palette: 2, overview: 3 };

function OverviewProgress({ stage }) {
  const current = STAGE_PROGRESS[stage] ?? -1;

  return (
    <div className="overview-progress" role="list" aria-label="After-writing progress">
      {STAGES.map((item, index) => {
        const done = stage === 'overview' ? true : index < current;
        const isCurrent = index === current;
        return (
          <span
            key={item.key}
            role="listitem"
            className={`overview-step ${done ? 'is-done' : ''} ${
              isCurrent ? 'is-current' : ''
            }`}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span className="overview-step-index">
              {done ? (
                <CheckIcon size={12} />
              ) : isCurrent && stage === 'reading' ? (
                <span className="tiny-spinner" />
              ) : (
                index + 1
              )}
            </span>
            <span className="overview-step-label">{item.label}</span>
          </span>
        );
      })}
    </div>
  );
}

function ReadingStage({ status }) {
  const progress = Math.min(100, Math.max(0, Math.round((status?.loadProgress || 0) * 100)));
  return (
    <div className="overview-panel overview-reading" aria-live="polite">
      <LichenMark size={46} />
      <h3 className="overview-heading">Reading your page…</h3>
      <p className="overview-copy">
        The companion is reading this page on your device. Nothing leaves it.
      </p>
      <div className="overview-loading">
        <span className="tiny-spinner" />
        <span>
          {status?.state === 'loading'
            ? `Waking the companion… ${progress}%`
            : 'Listening for what this page holds…'}
        </span>
      </div>
    </div>
  );
}

export default function AfterWritingOverview({
  open,
  intent = 'finish',
  selectedDate,
  title,
  draftBody,
  entry,
  status,
  busy,
  accentColor,
  onClose,
  onExtractMetadata,
  onMoodPalette,
  onSetMood,
  onApplyAccent,
  onOpenSettings
}) {
  const [stage, setStage] = useState('idle');
  const [metadata, setMetadata] = useState(null);
  const [paletteResult, setPaletteResult] = useState(null);
  const [moodOverride, setMoodOverride] = useState(null);
  const [readingWarning, setReadingWarning] = useState('');
  const [paletteWarning, setPaletteWarning] = useState('');
  const [paletteLoading, setPaletteLoading] = useState(false);
  const [moodSaving, setMoodSaving] = useState(false);

  const aliveRef = useRef(true);
  const runIdRef = useRef(0);
  const processedRef = useRef({ date: null, body: null });
  const wasOpenRef = useRef(false);
  const headingRef = useRef(null);
  const stageRef = useRef(null);

  const modelUnavailable = status?.state === 'missing' || status?.state === 'error';
  const mood = moodOverride ?? (Number.isInteger(entry?.mood) ? entry.mood : metadata?.mood ?? null);
  const summary = entry?.summary || metadata?.summary || '';
  const emotion = entry?.primaryEmotion || metadata?.primary_emotion || '';
  const tags =
    Array.isArray(entry?.tags) && entry.tags.length
      ? entry.tags
      : Array.isArray(metadata?.tags)
        ? metadata.tags
        : [];
  const palette = paletteResult || paletteForEntry(entry) || fallbackPalette({ date: selectedDate });
  const storedTintFallback = !paletteResult && entry?.paletteSource === 'fallback';
  const tintNote = paletteWarning
    ? paletteWarning
    : storedTintFallback
      ? 'This tint was chosen locally, not painted by the companion.'
      : '';
  const progress = ritualProgress(entry);
  const settled =
    progress.allDone ||
    (Number.isInteger(mood) &&
      Boolean(summary || emotion || tags.length) &&
      Boolean(paletteResult || progress.done.palette));
  const displayTitle = title?.trim() || entry?.title?.trim() || 'This page';
  const overviewLabel =
    modelUnavailable || readingWarning ? 'Page overview' : 'AI overview';
  const paletteStyle = palette
    ? {
        '--overview-accent': palette.hex_colors[0],
        '--overview-accent-soft': palette.hex_colors[1],
        '--overview-accent-wash': palette.hex_colors[2]
      }
    : undefined;

  useEffect(() => {
    // StrictMode runs setup -> cleanup -> setup on mount. Reset the flag in
    // setup so the simulated cleanup cannot leave it false forever and stall
    // every overview on the reading screen during development.
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const startFresh = useCallback(async () => {
    const run = ++runIdRef.current;
    processedRef.current = { date: selectedDate, body: draftBody };
    setMetadata(null);
    setPaletteResult(null);
    setMoodOverride(null);
    setReadingWarning('');
    setPaletteWarning('');
    setPaletteLoading(false);
    setMoodSaving(false);
    setStage('reading');

    if (modelUnavailable) {
      setReadingWarning(
        'The local companion is unavailable. You can still set a mood and settle the page with a local tint.'
      );
      setStage('mood');
      return;
    }

    let data = null;
    try {
      data = await onExtractMetadata();
    } catch {
      data = null;
    }
    if (!aliveRef.current || run !== runIdRef.current) return;

    if (data) {
      setMetadata(data.metadata || null);
      setStage('mood');
      return;
    }

    const hasStoredReading = Boolean(
      entry?.summary || entry?.primaryEmotion || (Array.isArray(entry?.tags) && entry.tags.length)
    );
    setReadingWarning(
      hasStoredReading
        ? 'The companion couldn’t refresh the reading. Showing the reading already saved for this page.'
        : 'The companion couldn’t read this page. You can still set a mood and settle it with a local tint.'
    );
    setStage('mood');
  }, [
    draftBody,
    entry?.primaryEmotion,
    entry?.summary,
    entry?.tags,
    modelUnavailable,
    onExtractMetadata,
    selectedDate
  ]);

  const startReview = useCallback(() => {
    processedRef.current = { date: selectedDate, body: draftBody };
    setMetadata(null);
    setPaletteResult(null);
    setMoodOverride(null);
    setReadingWarning('');
    setPaletteWarning('');
    setPaletteLoading(false);
    setMoodSaving(false);
    setStage('overview');
  }, [draftBody, selectedDate]);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    // Review opens the final overview for the reading already saved for this
    // page. Re-reading is a deliberate choice from that overview, so opening
    // Review never re-runs the companion or overwrites the stored reading.
    if (intent === 'review') {
      startReview();
      return;
    }

    // A deliberate "Read again" from the rail re-runs the whole reading, even
    // when this overview already processed the same page.
    if (intent === 'reread') {
      startFresh();
      return;
    }

    const processed = processedRef.current;
    if (processed.date !== selectedDate || processed.body !== draftBody) {
      startFresh();
    }
  }, [draftBody, intent, open, selectedDate, startFresh, startReview]);

  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || stage === 'idle' || stage === 'reading') return;
    stageRef.current?.focus();
  }, [open, stage]);

  const chooseMood = useCallback(
    async (value) => {
      const previous = mood;
      setMoodOverride(value);
      setMoodSaving(true);
      const updated = await onSetMood(value);
      if (!aliveRef.current) return;
      setMoodSaving(false);
      setMoodOverride(updated ? updated.mood : previous);
    },
    [mood, onSetMood]
  );

  const continueThemes = useCallback(() => {
    if (moodSaving) return;
    setStage('themes');
  }, [moodSaving]);

  const continuePalette = useCallback(async () => {
    setStage('palette');
    setPaletteResult(null);
    setPaletteWarning('');
    setPaletteLoading(true);

    if (modelUnavailable) {
      setPaletteWarning('A local tint was used because the companion is unavailable.');
      setPaletteLoading(false);
      return;
    }

    const data = await onMoodPalette();
    if (!aliveRef.current) return;
    if (data && data.palette) {
      setPaletteResult(data.palette);
      if (data.palette.fallback) {
        setPaletteWarning('A local tint was used because the companion could not paint this one.');
      }
    } else {
      setPaletteWarning('A local tint was used because the palette could not be painted.');
    }
    setPaletteLoading(false);
  }, [modelUnavailable, onMoodPalette]);

  const continueOverview = useCallback(() => {
    setStage('overview');
  }, []);

  const readAgain = useCallback(() => {
    if (busy) return;
    startFresh();
  }, [busy, startFresh]);

  return (
    <section
      className={`overview-pane ${open ? 'is-open' : ''}`}
      hidden={!open}
      aria-hidden={!open}
      aria-labelledby="overview-title"
      style={paletteStyle}
    >
      <div className="overview-card">
        <header className="overview-head">
          <div className="overview-brand">
            <LichenMark size={30} />
            <div>
              <p className="eyebrow">After writing</p>
              <h2 id="overview-title" ref={headingRef} tabIndex={-1} className="overview-title">
                {displayTitle}
              </h2>
              <p className="overview-date">{formatLongDate(selectedDate)}</p>
            </div>
          </div>
          <button
            type="button"
            className="button button-quiet button-small overview-back"
            onClick={onClose}
          >
            <ChevronLeftIcon size={14} />
            Back to page
          </button>
        </header>

        <OverviewProgress stage={stage} />

        {stage === 'idle' || stage === 'reading' ? <ReadingStage status={status} /> : null}

        {stage === 'mood' ? (
          <div className="overview-panel" ref={stageRef} tabIndex={-1} aria-live="polite">
            <p className="overview-stage-label">
              <LeafIcon size={12} />
              1 · Mood
            </p>
            <h3 className="overview-heading">How did this page feel?</h3>
            <p className="overview-copy">
              {metadata?.mood != null
                ? `The companion read this as ${metadata.mood} / 10 · ${moodLabel(metadata.mood)}.`
                : mood != null
                  ? 'Showing the mood already saved for this page.'
                  : 'The companion did not name a mood.'}{' '}
              Adjust the leaf if it doesn&apos;t fit.
            </p>

            {readingWarning ? (
              <div className="overview-warning">
                <AlertIcon size={16} />
                <div>
                  <p>{readingWarning}</p>
                  <div className="overview-warning-actions">
                    {modelUnavailable ? (
                      <button type="button" className="text-button" onClick={onOpenSettings}>
                        Vault settings
                      </button>
                    ) : (
                      <button type="button" className="text-button" onClick={startFresh}>
                        Try again
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="overview-mood">
              <div className="section-label-row">
                <span className="section-label">Mood</span>
                <span className="mood-readout">
                  <strong>{mood ?? '—'}</strong>
                  <span>/ 10 · {moodLabel(mood)}</span>
                </span>
              </div>
              <div className="mood-scale" role="group" aria-label="Set journal mood from 1 to 10">
                {Array.from({ length: 10 }, (_, index) => {
                  const value = index + 1;
                  const active = mood !== null && value <= mood;
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`mood-leaf ${active ? 'is-active' : ''} ${
                        mood === value ? 'is-current' : ''
                      }`}
                      onClick={() => chooseMood(value)}
                      disabled={moodSaving}
                      aria-label={`Mood ${value} of 10, ${moodLabel(value)}`}
                      aria-pressed={mood === value}
                      title={`${value} · ${moodLabel(value)}`}
                      style={{ '--leaf-height': `${9 + index * 1.15}px` }}
                    >
                      <span />
                    </button>
                  );
                })}
              </div>
              <div className="mood-caption">
                <span>heavy</span>
                <span>bright</span>
              </div>
              {moodSaving ? <p className="section-hint">Saving your mood…</p> : null}
            </div>

            <div className="overview-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={continueThemes}
                disabled={moodSaving}
              >
                Continue to themes
                <ArrowRightIcon size={14} />
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'themes' ? (
          <div className="overview-panel" ref={stageRef} tabIndex={-1} aria-live="polite">
            <p className="overview-stage-label">
              <TagIcon size={12} />
              2 · Themes
            </p>
            <h3 className="overview-heading">What was this page about?</h3>
            <p className="overview-copy">
              The companion read this page on your device. It never writes into your entry.
            </p>

            {emotion || summary || tags.length ? (
              <div className="overview-result">
                <span className={`emotion-badge ${emotion ? 'is-filled' : ''}`}>
                  {emotion || 'themes noted'}
                </span>
                {summary ? <p className="entry-summary">{summary}</p> : null}
                {tags.length ? (
                  <div className="tag-cloud">
                    {tags.map((tag) => (
                      <span key={tag} className="tag-chip is-static">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="section-hint">
                No reading is available yet. You can still continue to the palette.
              </p>
            )}

            <div className="overview-actions">
              <button type="button" className="button button-primary" onClick={continuePalette}>
                Continue to palette
                <ArrowRightIcon size={14} />
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'palette' ? (
          <div className="overview-panel" ref={stageRef} tabIndex={-1} aria-live="polite">
            <p className="overview-stage-label">
              <PaletteIcon size={12} />
              3 · Palette
            </p>
            <h3 className="overview-heading">What color was today?</h3>
            <p className="overview-copy">
              Three swatches painted from this page&apos;s tone. Click one to tint the page.
            </p>

            {paletteLoading ? (
              <div className="overview-loading">
                <span className="tiny-spinner" />
                <span>Painting the palette locally…</span>
              </div>
            ) : (
              <div className="palette-row overview-palette-row">
                <div className="overview-swatches">
                  {palette.hex_colors.map((color, index) => (
                    <button
                      key={`${color}-${index}`}
                      type="button"
                      className={`palette-swatch ${accentColor === color ? 'is-selected' : ''}`}
                      style={{ background: color }}
                      onClick={() => onApplyAccent(color)}
                      aria-pressed={accentColor === color}
                      aria-label={`Use ${color} as the ambient accent`}
                      title={`${color} · use as ambient accent`}
                    />
                  ))}
                </div>
                <div className="palette-copy">
                  <span className="palette-vibe">{palette.vibe_name}</span>
                  <span className="palette-hint">Click a swatch to tint the page</span>
                </div>
              </div>
            )}

            {tintNote ? <p className="overview-note">{tintNote}</p> : null}

            <div className="overview-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={continueOverview}
                disabled={paletteLoading}
              >
                See the overview
                <ArrowRightIcon size={14} />
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'overview' ? (
          <div className="overview-panel overview-settled" ref={stageRef} tabIndex={-1} aria-live="polite">
            <p className="overview-stage-label">
              <SparkleIcon size={12} />
              {overviewLabel}
            </p>
            <div className="overview-settled-head">
              <span className="overview-settled-mark" aria-hidden="true">
                <CheckIcon size={18} />
              </span>
              <h3 className="overview-heading">
                {settled ? 'Your page is complete.' : 'That’s the page for now.'}
              </h3>
            </div>
            <p className="overview-settled-sub">
              {settled
                ? 'Mood, themes, and palette, gathered in one place.'
                : 'Here is what the companion could gather for this page.'}
            </p>

            {summary ? (
              <blockquote className="overview-summary">“{summary}”</blockquote>
            ) : (
              <p className="overview-copy">
                The page is saved. Its mood and local tint are ready whenever you want them.
              </p>
            )}

            <dl className="overview-rows">
              <div
                className="overview-tile"
                style={{ '--tile-accent': palette.hex_colors[0] }}
              >
                <dt className="overview-tile-head">
                  <span className="overview-tile-icon">
                    <LeafIcon size={14} />
                  </span>
                  Mood
                </dt>
                <dd className="overview-tile-body">
                  <span className="overview-tile-value">
                    {mood !== null ? (
                      <>
                        <strong>{mood}</strong>
                        <span> / 10</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </span>
                  <span className="overview-tile-note">
                    {mood !== null ? moodLabel(mood) : 'not set'}
                  </span>
                </dd>
              </div>

              <div
                className="overview-tile"
                style={{ '--tile-accent': palette.hex_colors[1] }}
              >
                <dt className="overview-tile-head">
                  <span className="overview-tile-icon">
                    <TagIcon size={14} />
                  </span>
                  Themes
                </dt>
                <dd className="overview-tile-body">
                  <span className="overview-tile-emotion">{emotion || 'themes noted'}</span>
                  {tags.length ? (
                    <span className="overview-tile-tags">
                      {tags.map((tag) => (
                        <span key={tag} className="tag-chip is-static">
                          {tag}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="overview-tile-note">no tags noted</span>
                  )}
                </dd>
              </div>

              <div
                className="overview-tile"
                style={{ '--tile-accent': palette.hex_colors[2] }}
              >
                <dt className="overview-tile-head">
                  <span className="overview-tile-icon">
                    <PaletteIcon size={14} />
                  </span>
                  Palette
                </dt>
                <dd className="overview-tile-body">
                  <span className="overview-tile-swatches">
                    {palette.hex_colors.map((color, index) => (
                      <span
                        key={`${color}-${index}`}
                        className="palette-swatch palette-swatch-small"
                        style={{ background: color }}
                        aria-hidden="true"
                      />
                    ))}
                  </span>
                  <span className="overview-tile-note">{palette.vibe_name}</span>
                </dd>
              </div>
            </dl>

            {tintNote ? <p className="overview-note">{tintNote}</p> : null}

            <div className="overview-final-actions">
              <button
                type="button"
                className="text-button"
                onClick={readAgain}
                disabled={Boolean(busy)}
                title="Read this page again with the companion and refresh its mood, themes, and palette."
              >
                <RefreshIcon size={13} />
                Read again
              </button>
              <button type="button" className="button button-quiet" onClick={onClose}>
                <ChevronLeftIcon size={14} />
                Back to page
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
