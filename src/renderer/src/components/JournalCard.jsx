import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import {
  addDays,
  formatMediumDate,
  isToday,
  parseISODate,
  shiftMonths,
  shiftYears
} from '../lib/dates.js';
import { entryTitle, excerpt } from '../lib/text.js';
import { CalendarIcon, SunIcon } from './Icons.jsx';

const WINDOW_DAYS = 21;

function formatMonthDay(value) {
  const date = parseISODate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function paletteGradient(entry) {
  const colors = entry && entry.palette && entry.palette.hex_colors;
  if (!Array.isArray(colors) || colors.length === 0) return null;
  return `linear-gradient(180deg, ${colors.slice(0, 3).join(', ')})`;
}

function tickTitle(date, entry, loaded) {
  const day = formatMediumDate(date);
  if (!loaded) return `${day} · reading…`;
  if (!entry) return `${day} · no page`;
  const mood = Number.isFinite(entry.mood) ? `mood ${entry.mood}` : 'not read';
  return entry.primaryEmotion ? `${day} · ${mood} · ${entry.primaryEmotion}` : `${day} · ${mood}`;
}

function MoodWeather({ selectedDate, dataVersion, onSelectDate }) {
  const [byDate, setByDate] = useState(() => new Map());
  const [loaded, setLoaded] = useState(false);
  const seqRef = useRef(0);

  const dates = useMemo(() => {
    const from = addDays(selectedDate, -(WINDOW_DAYS - 1));
    if (!from) return [];
    return Array.from({ length: WINDOW_DAYS }, (_, index) => addDays(from, index));
  }, [selectedDate]);

  useEffect(() => {
    if (dates.length === 0) return undefined;
    const seq = ++seqRef.current;
    let cancelled = false;
    setLoaded(false);
    api.vault
      .range(dates[0], dates[dates.length - 1])
      .then((result) => {
        if (cancelled || seq !== seqRef.current) return;
        const list = Array.isArray(result) ? result : (result && result.entries) || [];
        const next = new Map();
        for (const entry of list) {
          next.set(entry.date, entry);
        }
        setByDate(next);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled || seq !== seqRef.current) return;
        setByDate(new Map());
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dates, dataVersion]);

  const filled = dates.filter((date) => {
    const entry = byDate.get(date);
    return Boolean(entry && (entry.wordCount > 0 || entry.mood !== null));
  }).length;

  return (
    <div className="weather-block">
      <div className="section-label-row">
        <span className="section-label">
          <SunIcon size={13} />
          Mood weather
        </span>
        <span className="weather-caption">
          {filled} of {WINDOW_DAYS} days
        </span>
      </div>
      <div className="weather-ticks" role="group" aria-label="The last three weeks of pages">
        {dates.map((date) => {
          const entry = byDate.get(date);
          const gradient = paletteGradient(entry);
          const blank = !entry || !(entry.wordCount > 0);
          const classes = ['weather-tick'];
          if (blank) classes.push('is-empty');
          else if (!gradient) classes.push('is-blank');
          if (date === selectedDate) classes.push('is-selected');
          if (isToday(date)) classes.push('is-today');
          return (
            <button
              key={date}
              type="button"
              className={classes.join(' ')}
              title={tickTitle(date, entry, loaded)}
              aria-label={`Open the page from ${formatMediumDate(date)}`}
              style={gradient ? { backgroundImage: gradient } : undefined}
              onClick={() => onSelectDate && onSelectDate(date)}
            />
          );
        })}
      </div>
    </div>
  );
}

function OnThisDay({ selectedDate, dataVersion, onSelectDate }) {
  const [pairs, setPairs] = useState([]);
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    let cancelled = false;
    const monthAgo = shiftMonths(selectedDate, -1);
    const yearAgo = shiftYears(selectedDate, -1);
    const load = (date) =>
      api.vault
        .get(date)
        .then((result) => ({ date, entry: (result && result.entry) || null }))
        .catch(() => ({ date, entry: null }));
    Promise.all([load(monthAgo), load(yearAgo)]).then((next) => {
      if (cancelled || seq !== seqRef.current) return;
      setPairs(next);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, dataVersion]);

  const found = pairs.filter(
    (pair) => pair.entry && (pair.entry.body || '').trim().length > 0
  );

  if (found.length === 0) {
    return <p className="journal-empty">Older pages will surface here.</p>;
  }

  return (
    <div className="on-this-day-list">
      {found.map(({ date, entry }) => {
        const gradient = paletteGradient(entry);
        return (
          <button
            key={date}
            type="button"
            className="on-this-day-row"
            title={`Open the page from ${formatMediumDate(date)}`}
            onClick={() => onSelectDate && onSelectDate(date)}
          >
            <span className="on-this-day-top">
              <span
                className="journal-dot"
                aria-hidden="true"
                style={gradient ? { backgroundImage: gradient } : undefined}
              />
              <span className="on-this-day-date">{formatMonthDay(date)}</span>
              <span className="on-this-day-title">{entryTitle(entry)}</span>
            </span>
            <span className="on-this-day-excerpt">{excerpt(entry.body, 96)}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function JournalCard({ selectedDate, dataVersion, onSelectDate }) {
  return (
    <section className="rail-card journal-card" aria-label="Journal">
      <MoodWeather
        selectedDate={selectedDate}
        dataVersion={dataVersion}
        onSelectDate={onSelectDate}
      />
      <div className="journal-divider" aria-hidden="true" />
      <div className="on-this-day">
        <span className="section-label">
          <CalendarIcon size={13} />
          On this day
        </span>
        <OnThisDay
          selectedDate={selectedDate}
          dataVersion={dataVersion}
          onSelectDate={onSelectDate}
        />
      </div>
    </section>
  );
}
