export const RITUAL_STEPS = [
  { key: 'mood', label: 'Mood' },
  { key: 'themes', label: 'Themes' },
  { key: 'palette', label: 'Palette' }
];

function hasStoredPalette(entry) {
  const palette = entry && entry.palette;
  return Boolean(
    palette &&
      Array.isArray(palette.hex_colors) &&
      palette.hex_colors.length === 3 &&
      palette.hex_colors.every((color) => typeof color === 'string' && color)
  );
}

export function ritualDone(entry) {
  const mood = Number(entry && entry.mood);
  return {
    mood: Number.isInteger(mood) && mood >= 1 && mood <= 10,
    themes: Boolean(
      entry &&
        (entry.primaryEmotion ||
          entry.summary ||
          (Array.isArray(entry.tags) && entry.tags.length > 0))
    ),
    palette: hasStoredPalette(entry)
  };
}

export function ritualProgress(entry) {
  const done = ritualDone(entry);
  const completed = RITUAL_STEPS.reduce(
    (count, step) => count + (done[step.key] ? 1 : 0),
    0
  );
  const firstIncomplete = RITUAL_STEPS.findIndex((step) => !done[step.key]);
  return {
    done,
    completed,
    firstIncomplete: firstIncomplete === -1 ? null : firstIncomplete,
    allDone: firstIncomplete === -1
  };
}
