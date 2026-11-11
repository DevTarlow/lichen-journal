export const DEFAULT_REFLECT_LENS = 'gentle';

export const REFLECT_LENSES = [
  {
    id: 'gentle',
    label: 'Gentle',
    hint: 'Slow, spacious, and soft in tone.',
    questionLabel: 'A gentle question'
  },
  {
    id: 'curious',
    label: 'Curious',
    hint: 'Notices the odd, easily-missed detail.',
    questionLabel: 'A curious question'
  },
  {
    id: 'direct',
    label: 'Direct',
    hint: 'Plainer and a little more candid.',
    questionLabel: 'A direct question'
  },
  {
    id: 'body',
    label: 'In the body',
    hint: 'Sensation, place, breath, texture.',
    questionLabel: 'A question from the body'
  }
];

export const REFLECT_LENS_IDS = REFLECT_LENSES.map((lens) => lens.id);

export function normalizeLens(value) {
  return REFLECT_LENS_IDS.includes(value) ? value : DEFAULT_REFLECT_LENS;
}

export function lensById(value) {
  const id = normalizeLens(value);
  return REFLECT_LENSES.find((lens) => lens.id === id);
}
