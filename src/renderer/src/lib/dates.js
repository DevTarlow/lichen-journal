export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function toISODate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayISO() {
  return toISODate(new Date());
}

export function parseISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function formatLongDate(value) {
  const date = typeof value === 'string' ? parseISODate(value) : value;
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

export function formatMediumDate(value) {
  const date = typeof value === 'string' ? parseISODate(value) : value;
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

export function formatMonthYear(year, month) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric'
  }).format(new Date(year, month, 1, 12));
}

export function formatWeekday(value) {
  const date = typeof value === 'string' ? parseISODate(value) : value;
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
}

export function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

export function monthFromDate(value) {
  const date = typeof value === 'string' ? parseISODate(value) : value;
  if (!date) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function addMonths({ year, month }, delta) {
  const date = new Date(year, month + delta, 1, 12);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function monthBounds(year, month) {
  const first = new Date(year, month, 1, 12);
  const last = new Date(year, month + 1, 0, 12);
  return { from: toISODate(first), to: toISODate(last) };
}

export function calendarDays(year, month) {
  const first = new Date(year, month, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset, 12);
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + index,
      12
    );
    cells.push({
      date: toISODate(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month
    });
  }
  return cells;
}

export function isToday(value) {
  return value === todayISO();
}

export function isDateInMonth(value, year, month) {
  const date = parseISODate(value);
  return Boolean(date && date.getFullYear() === year && date.getMonth() === month);
}

export function groupEntriesByMonth(entries) {
  const groups = [];
  const byKey = new Map();
  for (const entry of entries) {
    const date = parseISODate(entry.date);
    if (!date) continue;
    const key = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
    if (!byKey.has(key)) {
      const group = {
        key,
        label: new Intl.DateTimeFormat(undefined, {
          month: 'long',
          year: 'numeric'
        }).format(date),
        entries: []
      };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).entries.push(entry);
  }
  return groups;
}

export function dayParts(value) {
  const date = parseISODate(value);
  if (!date) return { day: '', weekday: '' };
  return {
    day: String(date.getDate()),
    weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)
  };
}

export function addDays(value, delta) {
  const date = parseISODate(value);
  if (!date) return '';
  date.setDate(date.getDate() + Math.trunc(delta));
  return toISODate(date);
}

export function shiftMonths(value, delta) {
  const date = parseISODate(value);
  if (!date) return '';
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + Math.trunc(delta), 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(day, lastDay));
  return toISODate(target);
}

export function shiftYears(value, delta) {
  return shiftMonths(value, Math.trunc(delta) * 12);
}

