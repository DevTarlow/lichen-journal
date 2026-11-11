'use strict';

// Developer-only demo journal. This is seeded by the "Reset + mock" header
// button so the after-writing flow can be exercised without typing entries or
// waiting for a model. Nothing here is imported by the packaged app path.

const MOCK_ENTRIES = Object.freeze([
  {
    daysAgo: 0,
    title: 'Moss after the rain',
    body:
      'The rain stopped just before lunch, so I walked the long way around the block. ' +
      'The moss on the north wall had gone the colour of new beans, almost too bright to look at. ' +
      'I stood there longer than I meant to and let the day slow down. Nothing was solved, but the air ' +
      'smelled clean and I came home feeling less crowded.',
    tags: ['walking', 'rain', 'moss'],
    mood: 7,
    primaryEmotion: 'calm',
    summary: 'A wet walk and the bright moss on the north wall.',
    anchors: ['the moss on the north wall', 'walking the long way around the block'],
    source: 'model',
    palette: {
      hex_colors: ['#6f8f6a', '#b9c9a3', '#e6e2d2'],
      vibe_name: 'rain-washed green'
    },
    reflection: 'What did the rain make easier to notice?'
  },
  {
    daysAgo: 1,
    title: 'A slower morning',
    body:
      'I let the first hour happen without a plan. Coffee, the window, the neighbour’s cat crossing the fence. ' +
      'I keep treating slow mornings as something I have to earn, but this one arrived on its own and I accepted it. ' +
      'By ten I had done less than usual and felt more like myself.',
    tags: ['rest', 'coffee'],
    mood: 5,
    primaryEmotion: 'content',
    summary: 'An unplanned first hour with coffee and the window.',
    anchors: ['the neighbour’s cat crossing the fence'],
    source: 'model'
  },
  {
    daysAgo: 2,
    title: 'The meeting I dreaded',
    body:
      'I had rehearsed the difficult sentence all morning. When the moment came, my voice shook and then steadied, ' +
      'and the room did not fall apart. We disagreed, but we stayed in the same conversation. I walked out into the ' +
      'car park with my shoulders lower than they had been all week. Courage, it turns out, is often just staying in the room.',
    tags: ['work', 'courage'],
    mood: 3,
    primaryEmotion: 'relieved',
    summary: 'A hard conversation that stayed a conversation.',
    anchors: ['the difficult sentence I rehearsed', 'staying in the room'],
    source: 'model',
    reflection: 'What helped you stay in the room today?',
    answer:
      'Remembering that the silence after my sentence was only a few seconds, not the end of anything.'
  },
  {
    daysAgo: 4,
    title: 'Cooking for one',
    body:
      'I made the soup I usually make for other people, just for me. It took most of the afternoon and the kitchen ' +
      'smelled of thyme and onions. Eating alone at the table instead of over the sink felt like a small correction. ' +
      'I put the second portion in the freezer for a day that needs it.',
    tags: ['food', 'home'],
    mood: 6,
    primaryEmotion: 'tender',
    summary: 'An afternoon soup, eaten at the table alone.',
    anchors: ['thyme and onions', 'the second portion in the freezer'],
    source: 'model',
    palette: {
      hex_colors: ['#a8794f', '#d8b98a', '#f1e6d4'],
      vibe_name: 'kitchen lamplight'
    }
  },
  {
    daysAgo: 6,
    title: 'Notes from the train',
    body:
      'The carriage was full of people going home. A boy explained his dream to his father in great detail and ' +
      'nobody minded listening. I wrote down three things I want to remember: the light on the river, the woman ' +
      'laughing at her phone, the station name I always forget. Travel makes me a better noticer, even when I am ' +
      'only going twenty minutes down the line.',
    tags: ['travel', 'observing'],
    mood: 8,
    primaryEmotion: 'curious',
    summary: 'Three small things noticed on an ordinary train ride.',
    anchors: ['the light on the river', 'the boy explaining his dream'],
    source: 'model',
    reflection: 'Which small thing from today would you like to keep?'
  },
  {
    daysAgo: 9,
    title: 'An ordinary Tuesday',
    body:
      'Nothing much happened. I answered emails, walked to the shop, burned the rice. The day had no shape I could ' +
      'point to. I used to think days like this were wasted, but I am starting to suspect they are the ground ' +
      'everything else stands on.',
    tags: ['work'],
    mood: null,
    primaryEmotion: 'ordinary',
    summary: 'A day with no shape, and maybe that is alright.',
    anchors: [],
    source: 'fallback'
  },
  {
    daysAgo: 12,
    title: 'Garden in November',
    body:
      'The garden is mostly stems now. I cut back the mint and left the seed heads for the birds. There is a kind ' +
      'of honesty in a garden at this time of year: no performance, just the structure underneath. I stood at the ' +
      'back door with cold hands and felt fond of the whole untidy thing.',
    tags: ['garden', 'weather'],
    mood: 4,
    primaryEmotion: 'wistful',
    summary: 'Cutting back mint and leaving seed heads for the birds.',
    anchors: ['the seed heads for the birds', 'the structure underneath'],
    source: 'model',
    palette: {
      hex_colors: ['#8b7299', '#b9a7bd', '#efeaf0'],
      vibe_name: 'dusk heather',
      fallback: true
    },
    reflection: 'What did the garden show you today?',
    answer: 'That the untidy parts are still part of the whole thing, and usually the most interesting.'
  },
  {
    daysAgo: 32,
    title: 'The first frost',
    body:
      'The first frost came overnight. The grass was white and the car doors were stiff. I found the gloves I lost ' +
      'last winter in the pocket of a coat I had not worn since March. Small reunions. The cold makes the house feel ' +
      'smaller and warmer, and I am glad of the excuse to stay in and read.',
    tags: ['garden', 'winter'],
    mood: 6,
    primaryEmotion: 'settled',
    summary: 'Frost, stiff car doors, and lost gloves found again.',
    anchors: ['the first frost', 'the gloves in the coat pocket'],
    source: 'model',
    palette: {
      hex_colors: ['#7c9172', '#c2b49a', '#f3eee1'],
      vibe_name: 'frosted sage'
    },
    reflection: 'What did the cold make room for?',
    answer: 'An afternoon indoors with no guilt about it.'
  }
]);

const MOCK_ENTRY_COUNT = MOCK_ENTRIES.length;

function dateAtOffset(base, days) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function seedMockJournal(vault, { now = new Date() } = {}) {
  if (!vault || typeof vault.saveEntry !== 'function') {
    throw new Error('A vault is required to seed the demo journal.');
  }
  const dates = [];
  for (const entry of MOCK_ENTRIES) {
    const date = dateAtOffset(now, entry.daysAgo);
    dates.push(date);
    vault.saveEntry({ date, title: entry.title, body: entry.body });
    vault.applyMetadata(date, {
      summary: entry.summary,
      primary_emotion: entry.primaryEmotion,
      mood: entry.mood,
      tags: entry.tags,
      anchors: entry.anchors,
      source: entry.source
    });
    if (entry.palette) vault.applyPalette(date, entry.palette);
    if (entry.reflection) {
      vault.saveReflection(date, entry.reflection);
      if (entry.answer) {
        vault.saveReflectionAnswer(date, entry.reflection, entry.answer);
      }
    }
  }
  return { count: dates.length, dates };
}

module.exports = { MOCK_ENTRIES, MOCK_ENTRY_COUNT, dateAtOffset, seedMockJournal };
