import React, { useState } from 'react';
import Companion from './Companion.jsx';
import ThisPageCard from './ThisPageCard.jsx';
import JournalCard from './JournalCard.jsx';
import { formatMediumDate } from '../lib/dates.js';
import { sanitizeCompanionText } from '../lib/text.js';
import { ArrowRightIcon, SparkleIcon } from './Icons.jsx';

function CarriedQuestion({ previous, hasDraft, busy, onReflect, onDismiss }) {
  const question = sanitizeCompanionText(previous.reflection);
  if (!question) return null;
  return (
    <section className="carried-card" aria-label="Question carried from the last page">
      <div className="section-label-row">
        <span className="section-label">
          <ArrowRightIcon size={13} />
          Carried from {formatMediumDate(previous.date)}
        </span>
        <button type="button" className="text-button" onClick={onDismiss}>
          Let it go
        </button>
      </div>
      <blockquote className="carried-quote">{question}</blockquote>
      <p className="carried-note">
        It belongs to that day. The companion can read today&apos;s page next to it.
      </p>
      <div className="carried-actions">
        <button
          type="button"
          className="button button-quiet button-small"
          onClick={onReflect}
          disabled={busy || !hasDraft}
        >
          <SparkleIcon size={13} />
          Ask again
        </button>
        {!hasDraft ? <span className="section-hint">Write a little first.</span> : null}
      </div>
    </section>
  );
}

export default function CompanionRail({
  entry,
  draftBody,
  status,
  busy,
  streamText,
  lens,
  previousQuestion,
  selectedDate,
  dataVersion,
  activeTags,
  onLensChange,
  onCarryPrevious,
  onSelectDate,
  onToggleTag,
  onSetMood,
  onReadAgain,
  onReflect,
  onAnswerReflection,
  onCancel,
  onReloadModel,
  onDownloadModel,
  onOpenSettings
}) {
  const [dismissedFor, setDismissedFor] = useState(null);
  const hasDraft = Boolean(draftBody && draftBody.trim());
  const hasOwnReflection = Boolean(entry && entry.reflection && entry.reflection.trim());
  const savedAnswer =
    entry && entry.reflection && Array.isArray(entry.reflections)
      ? entry.reflections.find((item) => item.question === entry.reflection)
      : null;
  const showCarried =
    previousQuestion &&
    previousQuestion.date !== undefined &&
    !hasOwnReflection &&
    dismissedFor !== previousQuestion.date;

  return (
    <aside className="companion-pane" aria-label="AI companion">
      <Companion
        entry={entry}
        draftBody={draftBody}
        status={status}
        busy={busy}
        streamText={streamText}
        lens={lens}
        onLensChange={onLensChange}
        onReflect={onReflect}
        onAnswer={onAnswerReflection}
        savedAnswer={savedAnswer ? savedAnswer.answer : ''}
        onCancel={onCancel}
        onReloadModel={onReloadModel}
        onDownloadModel={onDownloadModel}
        onOpenSettings={onOpenSettings}
      />

      {showCarried ? (
        <CarriedQuestion
          previous={previousQuestion}
          hasDraft={hasDraft}
          busy={Boolean(busy)}
          onReflect={onCarryPrevious}
          onDismiss={() => setDismissedFor(previousQuestion.date)}
        />
      ) : null}

      <ThisPageCard
        entry={entry}
        draftBody={draftBody}
        busy={Boolean(busy)}
        activeTags={activeTags}
        onToggleTag={onToggleTag}
        onSetMood={onSetMood}
        onReadAgain={onReadAgain}
      />

      <JournalCard
        selectedDate={selectedDate}
        dataVersion={dataVersion}
        onSelectDate={onSelectDate}
      />

      <footer className="companion-footer companion-rail-footer">
        <span className="privacy-dot" aria-hidden="true" />
        <p>
          Generated on this device with MiniCPM-V 4.7. Never uploaded, never trained on. Artificial
          reflection is not therapy.
        </p>
      </footer>
    </aside>
  );
}
