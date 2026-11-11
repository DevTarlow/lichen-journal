import React from 'react';
import { countWords } from '../lib/text.js';
import { AlertIcon, FeatherIcon, RefreshIcon, TagIcon } from './Icons.jsx';

const MOOD_MIN = 1;
const MOOD_MAX = 10;

function paletteOf(entry) {
  const palette = entry && entry.palette;
  if (!palette || !Array.isArray(palette.hex_colors) || palette.hex_colors.length === 0) {
    return null;
  }
  return palette;
}

export default function ThisPageCard({
  entry,
  draftBody,
  busy = false,
  activeTags = [],
  onToggleTag,
  onSetMood,
  onReadAgain
}) {
  if (!entry) return null;

  const words = countWords(draftBody || entry.body || '');
  const palette = paletteOf(entry);
  const mood = Number.isFinite(entry.mood) ? entry.mood : null;
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  const anchors = Array.isArray(entry.anchors) ? entry.anchors.filter(Boolean).slice(0, 3) : [];
  const unread = entry.metadataSource === 'fallback';
  const localTint = entry.paletteSource === 'fallback';

  const adjustMood = (delta) => {
    if (mood === null || typeof onSetMood !== 'function') return;
    const next = Math.min(MOOD_MAX, Math.max(MOOD_MIN, mood + delta));
    if (next !== mood) onSetMood(next);
  };

  return (
    <section className="rail-card this-page-card" aria-label="This page">
      <div className="section-label-row">
        <span className="section-label">
          <FeatherIcon size={13} />
          This page
        </span>
        <span className="page-words">
          {words} {words === 1 ? 'word' : 'words'}
        </span>
      </div>

      <div className="page-row page-row-palette">
        {palette ? (
          <>
            <span className="palette-strip" aria-hidden="true">
              {palette.hex_colors.slice(0, 3).map((hex, index) => (
                <span key={`${hex}-${index}`} style={{ backgroundColor: hex }} />
              ))}
            </span>
            <span className="page-vibe">
              {palette.vibe_name || 'a quiet tone'}
              {localTint ? (
                <span
                  className="page-vibe-note"
                  title="This tint was chosen locally, not by the companion."
                >
                  {' '}· local tint
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="page-empty">No palette yet.</span>
        )}
      </div>

      <div className="page-row">
        <span className="page-key">Mood</span>
        {mood === null ? (
          <span className="page-empty">Not read yet.</span>
        ) : (
          <span className="mood-stepper">
            <button
              type="button"
              className="mood-step"
              aria-label="Lower mood by one"
              disabled={mood <= MOOD_MIN}
              onClick={() => adjustMood(-1)}
            >
              −
            </button>
            <span className="page-mood-value">
              {mood}
              <span className="mood-of"> / 10</span>
            </span>
            <button
              type="button"
              className="mood-step"
              aria-label="Raise mood by one"
              disabled={mood >= MOOD_MAX}
              onClick={() => adjustMood(1)}
            >
              +
            </button>
          </span>
        )}
      </div>

      {entry.primaryEmotion ? (
        <div className="page-row">
          <span className="page-key">Feeling</span>
          <span className="page-value page-emotion">{entry.primaryEmotion}</span>
        </div>
      ) : null}

      {anchors.length > 0 ? (
        <div className="page-row page-row-anchors">
          <span className="page-key">Lines</span>
          <span className="page-anchors">
            {anchors.map((anchor, index) => (
              <span
                key={`${index}-${anchor.slice(0, 16)}`}
                className="page-anchor"
                title="A line that shaped this reading."
              >
                {`“${anchor}”`}
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {unread ? (
        <div className="page-note" role="note">
          <AlertIcon size={13} />
          <span className="page-note-copy">
            The companion couldn&apos;t finish reading this page.
          </span>
          {typeof onReadAgain === 'function' ? (
            <button
              type="button"
              className="text-button page-note-action"
              onClick={onReadAgain}
              disabled={Boolean(busy)}
              title="Read this page again with the companion."
            >
              <RefreshIcon size={12} />
              Read again
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="page-row page-row-tags">
        <span className="page-key">
          <TagIcon size={12} />
          Themes
        </span>
        {tags.length === 0 ? (
          <span className="page-empty">None yet.</span>
        ) : (
          <span className="page-tags">
            {tags.map((tag) => {
              const active = activeTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`page-tag-chip${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  title={`Filter the journal by ${tag}`}
                  onClick={() => onToggleTag && onToggleTag(tag)}
                >
                  {tag}
                </button>
              );
            })}
          </span>
        )}
      </div>
    </section>
  );
}
