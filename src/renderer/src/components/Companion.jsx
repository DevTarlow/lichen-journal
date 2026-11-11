import React from 'react';
import { countWords, sanitizeCompanionText } from '../lib/text.js';
import { DEFAULT_REFLECT_LENS, REFLECT_LENSES, lensById } from '../lib/lenses.js';
import { backendLabel } from '../lib/compute.js';
import {
  AlertIcon,
  BookOpenIcon,
  CpuIcon,
  FeatherIcon,
  InfoIcon,
  LichenMark,
  QuoteIcon,
  RefreshIcon,
  SparkleIcon,
  XIcon
} from './Icons.jsx';

function formatModelBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return 'Not found';
  if (value < 1024 * 1024 * 1024) return `${Math.round(value / (1024 * 1024))} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function companionView(status, busy) {
  if (busy === 'model' || status.state === 'loading') {
    const progress = Math.min(100, Math.max(0, Math.round((status.loadProgress || 0) * 100)));
    return {
      tone: 'is-loading',
      label: 'Waking',
      progress,
      copy: progress > 0 ? `Waking the local model… ${progress}%` : 'Waking the local model…'
    };
  }
  if (status.state === 'missing') {
    return {
      tone: 'is-warning',
      label: 'Offline',
      copy: 'The MiniCPM-V model file is missing from this installation.'
    };
  }
  if (status.state === 'error') {
    return {
      tone: 'is-error',
      label: 'Offline',
      copy: status.error?.message || 'The local model could not start.'
    };
  }
  if (status.state === 'disposed') {
    return { label: 'Resting', copy: 'The companion is resting.' };
  }
  if (status.state === 'ready') {
    return {
      tone: 'is-ready',
      label: 'Online',
      copy: status.computeFallback
        ? 'Ready on the processor. The video card could not be used.'
        : 'Ready on this device.'
    };
  }
  if (status.modelPresent) {
    return { tone: 'is-ready', label: 'Online', copy: 'Loads on the first reflection.' };
  }
  return { label: 'Checking', copy: 'Looking for the local model file…' };
}

function CompanionStatus({ status, busy }) {
  const view = companionView(status, busy);
  const detailsId = 'companion-status-details';

  return (
    <div className={`companion-status ${view.tone || ''}`.trim()}>
      <span className="status-dot" />
      <span className="companion-status-label">{view.label}</span>
      <span className="companion-info-wrap">
        <button
          type="button"
          className="companion-info"
          aria-label="Companion details"
          aria-describedby={detailsId}
        >
          <InfoIcon size={13} />
        </button>
        <div className="companion-status-tooltip" id={detailsId} role="tooltip">
          <p className="companion-tooltip-title">Companion details</p>
          <p className="companion-tooltip-copy">{view.copy}</p>
          <dl className="companion-tooltip-rows">
            <div>
              <dt>Runs on</dt>
              <dd>{backendLabel(status.backend)}</dd>
            </div>
            <div>
              <dt>Threads</dt>
              <dd>{status.threads || 1}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{status.modelPresent ? formatModelBytes(status.modelBytes) : 'Not found'}</dd>
            </div>
          </dl>
          <p className="companion-tooltip-note">Runs entirely on this machine. Never uploaded.</p>
        </div>
      </span>
      {view.progress !== undefined ? (
        <span className="model-progress" aria-hidden="true">
          <span style={{ width: `${Math.max(6, view.progress)}%` }} />
        </span>
      ) : null}
    </div>
  );
}

export default function Companion({
  entry,
  draftBody,
  status,
  busy,
  streamText,
  lens = DEFAULT_REFLECT_LENS,
  onLensChange,
  onReflect,
  onAnswer,
  savedAnswer = '',
  onCancel,
  onReloadModel,
  onDownloadModel,
  onOpenSettings
}) {
  const hasText = Boolean(draftBody && draftBody.trim());
  const reflection = sanitizeCompanionText(entry && entry.reflection ? entry.reflection : '');
  const streamingText = sanitizeCompanionText(streamText);
  const disabled = Boolean(busy) || !hasText;
  const streaming = busy === 'reflect';
  const modelUnavailable = status.state === 'missing' || status.state === 'error';
  const activeLens = lensById(lens);
  const wordCount = hasText ? countWords(draftBody) : 0;
  const savedBody = entry && typeof entry.body === 'string' ? entry.body : '';
  const unsaved = hasText && draftBody !== savedBody;

  return (
    <section className="companion-card" aria-labelledby="companion-title">
      <header className="companion-head">
        <div className="companion-brand">
          <LichenMark size={34} />
          <div>
            <p className="eyebrow">Companion</p>
            <h2 id="companion-title">Local reflection</h2>
          </div>
        </div>
        <span className="local-chip">
          <CpuIcon size={12} />
          on-device
        </span>
      </header>

      <p className="companion-context">
        <BookOpenIcon size={13} />
        {hasText ? (
          <span>
            Reading this page · {wordCount} {wordCount === 1 ? 'word' : 'words'}
            {unsaved ? <span className="companion-context-note"> · unsaved changes</span> : null}
          </span>
        ) : (
          <span>Reading this page · nothing written yet</span>
        )}
      </p>

      <CompanionStatus status={status} busy={busy} />

      {modelUnavailable ? (
        <div className="companion-alert" role="alert">
          <AlertIcon size={17} />
          <div>
            <p>
              {status.state === 'missing'
                ? 'The companion model is not installed yet. Journalling still works fully offline.'
                : status.error?.message || 'The local model could not start.'}
            </p>
            <div className="alert-actions">
              {status.state === 'missing' ? (
                <button type="button" className="text-button" onClick={onDownloadModel}>
                  Download model
                </button>
              ) : (
                <button type="button" className="text-button" onClick={onReloadModel} disabled={Boolean(busy)}>
                  <RefreshIcon size={13} /> Retry
                </button>
              )}
              <button type="button" className="text-button" onClick={onOpenSettings}>
                Vault settings
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="lens-row" role="group" aria-label="Angle for the next question">
        {REFLECT_LENSES.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`lens-chip${lens === option.id ? ' is-active' : ''}`}
            aria-pressed={lens === option.id}
            title={option.hint}
            onClick={() => onLensChange && onLensChange(option.id)}
            disabled={streaming}
          >
            {option.label}
          </button>
        ))}
      </div>

      <section className="reflection-block" aria-label="Reflection prompt">
        <div className="section-label-row">
          <span className="section-label">
            <QuoteIcon size={13} />
            {activeLens.questionLabel}
          </span>
          {reflection && !streaming ? (
            <button
              type="button"
              className="text-button"
              onClick={onReflect}
              disabled={disabled}
              title={`Ask again with a ${activeLens.label.toLowerCase()} angle`}
            >
              <RefreshIcon size={12} />
              Ask again
            </button>
          ) : null}
        </div>

        {streaming ? (
          <div className="reflection-quote is-streaming" aria-live="polite">
            <span className="stream-caret" aria-hidden="true" />
            {streamingText ? (
              streamingText
            ) : (
              <span className="reflection-placeholder">Listening for a question…</span>
            )}
          </div>
        ) : reflection ? (
          <blockquote className="reflection-quote">{reflection}</blockquote>
        ) : (
          <p className="reflection-placeholder">
            When you&apos;re ready, the companion can offer one small question to sit with.
          </p>
        )}

        <div className="reflection-actions">
          <button
            type="button"
            className="button button-primary button-small"
            onClick={onReflect}
            disabled={disabled}
          >
            {streaming ? <span className="tiny-spinner" /> : <SparkleIcon size={14} />}
            {streaming ? 'Reflecting…' : reflection ? 'Ask for a question' : 'Reflect with companion'}
          </button>
          {reflection && !streaming ? (
            <button
              type="button"
              className="button button-quiet button-small"
              onClick={() => onAnswer && onAnswer()}
            >
              <FeatherIcon size={13} />
              {savedAnswer ? 'Edit answer' : 'Write an answer'}
            </button>
          ) : null}
          {streaming ? (
            <button type="button" className="button button-quiet button-small" onClick={onCancel}>
              <XIcon size={13} />
              Cancel
            </button>
          ) : (
            <span className="shortcut-hint companion-shortcut">{'⌘ / Ctrl'} ↵</span>
          )}
        </div>
        {!hasText ? <p className="section-hint">Write a few words to wake this gently.</p> : null}
      </section>
    </section>
  );
}
