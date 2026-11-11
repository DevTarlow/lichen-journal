import React from 'react';
import {
  calendarDays,
  formatMediumDate,
  formatMonthYear,
  isDateInMonth,
  isToday,
  parseISODate,
  todayISO,
  toISODate,
  WEEKDAYS
} from '../lib/dates.js';
import { hexToRgba, moodLabel, paletteForEntry } from '../lib/palettes.js';
import { ChevronLeftIcon, ChevronRightIcon } from './Icons.jsx';

export default function Calendar({
  month,
  entriesByDate,
  selectedDate,
  onSelectDate,
  onChangeMonth,
  onToday
}) {
  const cells = calendarDays(month.year, month.month);
  const firstInMonth = cells.find((cell) => cell.inMonth)?.date;
  const todayDate = todayISO();
  const focusableDate =
    selectedDate && isDateInMonth(selectedDate, month.year, month.month)
      ? selectedDate
      : isDateInMonth(todayDate, month.year, month.month)
        ? todayDate
        : firstInMonth;

  const handleKeyDown = (event, date) => {
    const moves = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7
    };
    const delta = moves[event.key];
    if (!delta) return;
    const parsed = parseISODate(date);
    if (!parsed) return;
    event.preventDefault();
    const target = new Date(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate() + delta,
      12
    );
    const targetDate = toISODate(target);
    const targetElement = event.currentTarget
      .closest('.calendar-grid')
      ?.querySelector(`[data-date="${targetDate}"]`);
    if (targetElement) targetElement.focus();
  };

  return (
    <section className="calendar-panel" aria-label="Journal calendar">
      <div className="calendar-head">
        <div>
          <p className="eyebrow">Calendar</p>
          <h2>{formatMonthYear(month.year, month.month)}</h2>
        </div>
        <div className="calendar-nav">
          <button
            type="button"
            className="icon-button icon-button-small"
            onClick={() => onChangeMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeftIcon size={16} />
          </button>
          <button
            type="button"
            className="calendar-today"
            onClick={onToday}
            title="Show today"
          >
            Today
          </button>
          <button
            type="button"
            className="icon-button icon-button-small"
            onClick={() => onChangeMonth(1)}
            aria-label="Next month"
          >
            <ChevronRightIcon size={16} />
          </button>
        </div>
      </div>

      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day.slice(0, 1)}</span>
        ))}
      </div>

      <div className="calendar-grid" role="group" aria-label={formatMonthYear(month.year, month.month)}>
        {cells.map((cell) => {
          const entry = cell.inMonth ? entriesByDate.get(cell.date) : null;
          const palette = entry ? paletteForEntry(entry) : null;
          const inMonth = isDateInMonth(cell.date, month.year, month.month);
          const selected = cell.date === selectedDate;
          const today = isToday(cell.date);
          const classes = [
            'calendar-day',
            inMonth ? '' : 'is-adjacent',
            selected ? 'is-selected' : '',
            today ? 'is-today' : '',
            entry ? 'has-entry' : ''
          ]
            .filter(Boolean)
            .join(' ');

          const style = palette
            ? {
                '--day-wash': hexToRgba(palette.hex_colors[0], 0.3),
                '--day-wash-soft': hexToRgba(palette.hex_colors[1], 0.17),
                '--day-anchor': palette.hex_colors[0]
              }
            : undefined;

          const description = [
            formatMediumDate(cell.date),
            entry ? `${moodLabel(entry.mood)}${entry.primaryEmotion ? ` · ${entry.primaryEmotion}` : ''}` : 'no entry',
            entry && entry.title ? entry.title : ''
          ]
            .filter(Boolean)
            .join(' — ');

          return (
            <button
              key={cell.date}
              type="button"
              className={classes}
              style={style}
              data-date={cell.date}
              onClick={() => onSelectDate(cell.date)}
              onKeyDown={(event) => handleKeyDown(event, cell.date)}
              aria-label={description}
              aria-pressed={selected}
              aria-current={today ? 'date' : undefined}
              title={description}
              tabIndex={cell.date === focusableDate ? 0 : -1}
            >
              <span className="calendar-day-number">{cell.day}</span>
              {palette ? (
                <span className="calendar-mood-dot" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
