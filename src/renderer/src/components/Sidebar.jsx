import React from 'react';
import Calendar from './Calendar.jsx';
import {
  dayParts,
  formatMediumDate,
  groupEntriesByMonth
} from '../lib/dates.js';
import { moodLabel, paletteForEntry } from '../lib/palettes.js';
import { excerpt, snippetParts } from '../lib/text.js';
import {
  ChevronRightIcon,
  SearchIcon,
  TagIcon,
  XIcon
} from './Icons.jsx';

function EntryRow({ entry, selected, onSelect }) {
  const palette = paletteForEntry(entry);
  const date = dayParts(entry.date);
  const parts = entry.snippet ? snippetParts(entry.snippet) : null;
  const preview = parts && parts.length
    ? parts.map((part, index) =>
        part.highlighted ? (
          <mark key={`${part.text}-${index}`}>{part.text}</mark>
        ) : (
          <React.Fragment key={`${part.text}-${index}`}>{part.text}</React.Fragment>
        )
      )
    : excerpt(entry.excerpt || '', 128);

  const title = entry.title.trim() || 'Untitled reflection';

  return (
    <button
      type="button"
      className={`entry-row ${selected ? 'is-active' : ''}`}
      onClick={() => onSelect(entry.date)}
      aria-current={selected ? 'true' : undefined}
      title={`${formatMediumDate(entry.date)} · ${title}`}
    >
      <span className="entry-date-stamp" aria-hidden="true">
        <strong>{date.day}</strong>
        <span>{date.weekday}</span>
      </span>
      <span className="entry-row-main">
        <span className="entry-row-title">
          <span className="entry-title-text">{title}</span>
          {palette ? (
            <span
              className="mood-dot"
              style={{ background: palette.hex_colors[0] }}
              aria-hidden="true"
            />
          ) : null}
        </span>
        <span className="entry-excerpt">{preview || 'A quiet page.'}</span>
        <span className="entry-row-meta">
          {entry.primaryEmotion ? (
            <span className="entry-emotion">{entry.primaryEmotion}</span>
          ) : null}
          {entry.mood ? <span>{moodLabel(entry.mood)}</span> : null}
          {Array.isArray(entry.tags) && entry.tags.length ? (
            <span className="entry-tag-preview">
              <TagIcon size={11} />
              {entry.tags.slice(0, 2).join(' · ')}
            </span>
          ) : null}
          <span>{entry.wordCount || 0}w</span>
        </span>
      </span>
      <ChevronRightIcon size={15} className="entry-chevron" />
    </button>
  );
}

function Timeline({ entries, selectedDate, onSelect, emptyCopy }) {
  if (!entries.length) {
    return <p className="timeline-empty">{emptyCopy}</p>;
  }
  const groups = groupEntriesByMonth(entries);
  return groups.map((group) => (
    <section key={group.key} className="timeline-group" aria-label={group.label}>
      <h3 className="timeline-month">{group.label}</h3>
      <div className="timeline-rows">
        {group.entries.map((entry) => (
          <EntryRow
            key={entry.date}
            entry={entry}
            selected={entry.date === selectedDate}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  ));
}

export default function Sidebar({
  searchQuery,
  onSearchChange,
  onClearSearch,
  searchInputRef,
  activeTags,
  tags,
  onToggleTag,
  onClearTags,
  month,
  entriesByDate,
  selectedDate,
  onSelectDate,
  onChangeMonth,
  onToday,
  recentEntries,
  searchResults,
  searching,
  info,
  stats,
  isOpen,
  onClose
}) {
  const filtering = Boolean(searchQuery.trim()) || activeTags.length > 0;
  const entries = searchResults || recentEntries;
  const shortcut = info && info.platform === 'darwin' ? '⌘K' : 'Ctrl K';

  return (
    <aside className={`sidebar ${isOpen ? 'is-open' : ''}`} aria-label="Journal navigation">
      <div className="sidebar-scroll">
        <div className="search-field">
          <SearchIcon size={16} className="search-icon" />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClearSearch();
              }
            }}
            placeholder="Search your pages"
            aria-label="Search journal entries"
            spellCheck="false"
            autoComplete="off"
          />
          {searchQuery ? (
            <button
              type="button"
              className="search-clear"
              onClick={onClearSearch}
              aria-label="Clear search"
            >
              <XIcon size={14} />
            </button>
          ) : (
            <kbd className="search-shortcut">{shortcut}</kbd>
          )}
        </div>

        <div className="filter-head">
          <span className="eyebrow">Tags</span>
          {activeTags.length ? (
            <button type="button" className="text-button" onClick={onClearTags}>
              Clear
            </button>
          ) : null}
        </div>
        <div className="tag-filter-list">
          {tags.length ? (
            tags.map((tag) => {
              const active = activeTags.includes(tag.name);
              return (
                <button
                  key={tag.name}
                  type="button"
                  className={`tag-chip ${active ? 'is-active' : ''}`}
                  onClick={() => onToggleTag(tag.name)}
                  aria-pressed={active}
                >
                  {tag.name}
                  <span>{tag.count}</span>
                </button>
              );
            })
          ) : (
            <p className="tags-empty">Tags appear once the companion has read a page.</p>
          )}
        </div>

        <Calendar
          month={month}
          entriesByDate={entriesByDate}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          onChangeMonth={onChangeMonth}
          onToday={onToday}
        />

        <div className="timeline-head">
          <div>
            <p className="eyebrow">{filtering ? 'Local search' : 'Timeline'}</p>
            <h2>
              {filtering
                ? `${entries.length} ${entries.length === 1 ? 'page' : 'pages'} found`
                : 'Recent pages'}
            </h2>
          </div>
          {searching ? <span className="tiny-spinner" aria-label="Searching" /> : null}
        </div>

        <div className="timeline" aria-live="polite">
          {searching && !entries.length ? (
            <div className="timeline-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <Timeline
              entries={entries}
              selectedDate={selectedDate}
              onSelect={onSelectDate}
              emptyCopy={
                filtering
                  ? 'Nothing in your local vault matches that yet.'
                  : 'Your first page is waiting. Write a few words to begin the timeline.'
              }
            />
          )}
        </div>
      </div>

      <footer className="sidebar-footer">
        <div className="sidebar-stats">
          <strong>{stats ? stats.entryCount : info?.stats?.entryCount || 0}</strong>
          <span>
            {(stats ? stats.entryCount : info?.stats?.entryCount || 0) === 1 ? 'page' : 'pages'}
          </span>
          <span className="dot-separator" aria-hidden="true">
            ·
          </span>
          <span>
            {(stats ? stats.wordCount : info?.stats?.wordCount || 0).toLocaleString()} words
          </span>
        </div>
      </footer>

      <button
        type="button"
        className="sidebar-close"
        onClick={onClose}
        aria-label="Hide journal navigation"
      >
        <XIcon size={16} />
      </button>
    </aside>
  );
}
