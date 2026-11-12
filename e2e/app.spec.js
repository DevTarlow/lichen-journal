import { test, expect, _electron as electron } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, 'e2e', 'app.spec.js'));
const { Vault } = require('../src/main/db.js');
const { computeCapabilities } = require('../src/main/compute-utils.js');
const BODY = 'The moss by the river was bright after the rain. I felt quiet and a little hopeful.';

const COMPANION_MODEL_FILE = 'MiniCPM-V-4_7-1B-Q4_K_M.gguf';

function companionModelPath(extraEnv = {}) {
  const dir =
    extraEnv.LICHEN_MODEL_DIR ||
    process.env.LICHEN_MODEL_DIR ||
    path.join(ROOT, 'models');
  return path.join(dir, COMPANION_MODEL_FILE);
}

function hasCompanionModel(extraEnv = {}) {
  return fs.existsSync(companionModelPath(extraEnv));
}

async function launchApp(userDataDir, extraEnv = {}, options = {}) {
  const app = await electron.launch({
    args: [`--user-data-dir=${userDataDir}`,
      '--disable-gpu',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--no-sandbox',
      '.'],
    cwd: ROOT,
    env: {
      ...process.env,
      LICHEN_USER_DATA_DIR: userDataDir,
      LICHEN_ENABLE_GPU: '0',
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      ...extraEnv
    }
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('.app-header', { timeout: 45_000 });
  if (options.dismissModelSetup !== false && !hasCompanionModel(extraEnv)) {
    const setupHeading = page.getByRole('heading', { name: 'Set up the extras' });
    try {
      await setupHeading.waitFor({ state: 'visible', timeout: 3000 });
      await page.getByRole('button', { name: 'Not now' }).click();
      await setupHeading.waitFor({ state: 'hidden', timeout: 5000 });
    } catch {
      // No first-run setup was shown, or it was already dismissed.
    }
  }
  return { app, page, errors };
}



async function startModelServer(files) {
  const server = http.createServer((request, response) => {
    const data = files[request.url.split('?')[0]];
    if (!data) {
      response.writeHead(404);
      response.end('missing');
      return;
    }
    response.writeHead(200, { 'Content-Length': data.length });
    response.end(data);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

function makeUserDataDir() {
  return fs.mkdtempSync(path.join(ROOT, '.e2e-userdata-'));
}

test('boots into an empty private vault', async () => {
  test.setTimeout(60_000);
  const userDataDir = makeUserDataDir();
  const { app, page, errors } = await launchApp(userDataDir);
  try {
    await expect(page.getByRole('heading', { name: 'Lichen Journal' }).first()).toBeVisible();
    await expect(page.getByText('Private & Offline')).toBeVisible();
    await expect(page.getByText('A quiet place to notice', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Journal entry')).toBeVisible();
    await expect(page.locator('.page-front .save-state')).toContainText('Not saved yet');
    await expect(page.locator('.editor-actions')).toHaveCount(0);
    await expect(page.locator('.sidebar-footer .vault-link')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open vault settings' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Finish page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish page' })).toBeDisabled();
    await expect(page.locator('.overview-pane')).toBeHidden();
    await expect(page.locator('.companion-card')).toBeVisible();
    await expect(page.locator('.tend-card')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('autosaves on close, reloads, searches, and keeps theme', async () => {
  test.setTimeout(90_000);
  const userDataDir = makeUserDataDir();
  let { app, page, errors } = await launchApp(userDataDir);
  try {
    await page.getByRole('button', { name: /Begin today's entry/ }).click();
    await page.getByLabel('Entry title').fill('River notes');
    await page.getByLabel('Journal entry').fill(BODY);
    // Close before the 450ms autosave debounce so the close handshake is exercised.
    await app.close();

    ({ app, page, errors } = await launchApp(userDataDir));
    await expect(page.getByLabel('Entry title')).toHaveValue('River notes');
    await expect(page.getByLabel('Journal entry')).toHaveValue(BODY);
    await expect(page.locator('.page-front .save-state')).toContainText(/Saved at|Saved locally/);

    await page.getByLabel('Search journal entries').fill('moss');
    const result = page.locator('.entry-row').filter({ hasText: 'River notes' });
    await expect(result).toBeVisible();
    await expect(page.locator('.entry-row mark').first()).toHaveText(/moss/i);

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByRole('button', { name: 'Finish page' })).toBeEnabled();
    await expect(page.locator('.calendar-day.is-selected')).toHaveClass(/has-entry/);

    const html = page.locator('html');
    const initialTheme = await html.getAttribute('data-theme');
    await page.getByRole('button', { name: /Switch to .* theme/ }).click();
    await expect(html).toHaveAttribute('data-theme', initialTheme === 'dark' ? 'light' : 'dark');
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('settings exposes the vault, verifies offline, and double-confirms purge', async () => {
  test.setTimeout(90_000);
  const userDataDir = makeUserDataDir();
  const { app, page, errors } = await launchApp(userDataDir);
  try {
    await page.getByRole('button', { name: /Begin today's entry/ }).click();
    await page.getByLabel('Entry title').fill('To be cleared');
    await page.getByLabel('Journal entry').fill(BODY);
    await expect(page.locator('.page-front .save-state')).toContainText(/Saved at|Saved locally/);

    await page.getByRole('button', { name: 'Open vault settings' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vault settings' })).toBeVisible();

    if (
      hasCompanionModel() &&
      (process.platform === 'linux' || process.platform === 'win32') &&
      process.arch === 'x64'
    ) {
      await expect(page.getByLabel('Faster answers with my video card')).toBeVisible();
      await expect(page.getByText('Using the processor.')).toBeVisible();
    }

    const databasePath = await page
      .locator('.path-row')
      .filter({ hasText: 'Vault database' })
      .locator('code')
      .innerText();
    expect(databasePath).toContain(userDataDir);
    expect(databasePath).toContain('lichen_journal.sqlite');

    const exposedPath = await page.evaluate(async () => {
      const response = await window.lichen.vault.getPath();
      return response.data.dbPath;
    });
    expect(exposedPath).toBe(databasePath);

    const exportPath = path.join(userDataDir, 'export.zip');
    await app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
    }, exportPath);
    await page.getByRole('button', { name: 'Export vault to ZIP' }).click();
    await expect(page.getByText(/Vault exported: 1 entry/)).toBeVisible({ timeout: 20_000 });
    expect(fs.existsSync(exportPath)).toBe(true);
    const archive = new AdmZip(exportPath);
    const names = archive.getEntries().map((entry) => entry.entryName);
    expect(names).toContain('metadata.json');
    expect(names.some((name) => name.endsWith('.md'))).toBe(true);
    expect(JSON.parse(archive.readAsText('metadata.json')).entries).toHaveLength(1);

    await page.getByRole('button', { name: 'Run air-gap self-check' }).click();
    await expect(page.getByText('Blocked. The probe could not reach the network.')).toBeVisible({
      timeout: 15_000
    });

    await page.getByRole('button', { name: 'Clear all vault data…' }).click();
    await expect(page.getByText('Delete 1 entry forever?')).toBeVisible();
    const confirmInput = page.locator('#purge-confirmation');
    await expect(confirmInput).toBeVisible();
    const destructive = page.getByRole('button', { name: 'Permanently clear vault' });
    await expect(destructive).toBeDisabled();
    await confirmInput.fill('PURGE');
    await expect(destructive).toBeEnabled();
    await destructive.click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('A quiet place to notice', { exact: false })).toBeVisible();
    await expect(page.locator('.page-front .save-state')).toContainText('Not saved yet');

    await page.getByLabel('Search journal entries').fill('moss');
    await expect(page.getByText('Nothing in your local vault matches that yet.')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});


test('checks the video card without exposing driver details', async () => {
  test.setTimeout(120_000);
  if (!((process.platform === 'linux' || process.platform === 'win32') && process.arch === 'x64')) {
    test.skip();
    return;
  }
  if (!hasCompanionModel()) {
    test.skip();
    return;
  }
  const userDataDir = makeUserDataDir();
  const { app, page, errors } = await launchApp(userDataDir);
  try {
    await page.getByRole('button', { name: 'Open vault settings' }).click();
    const toggle = page.getByLabel('Faster answers with my video card');
    await expect(toggle).toBeVisible();
    const status = page.locator('.compute-fineprint');
    await expect(status).toContainText('Using the processor.');
    await toggle.click();
    await expect(status).toContainText(/Using your video card|processor/i, {
      timeout: 90_000
    });
    const copy = await status.innerText();
    expect(copy).not.toMatch(/CUDA|Vulkan|Metal|VRAM/i);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('Finish page walks the page through the after-writing overview', async () => {
  test.setTimeout(150_000);
  if (!hasCompanionModel()) {
    test.skip();
    return;
  }
  const userDataDir = makeUserDataDir();
  const { app, page, errors } = await launchApp(userDataDir);
  try {
    await page.getByRole('button', { name: /Begin today's entry/ }).click();
    await page.getByLabel('Entry title').fill('Late afternoon');
    await page
      .getByLabel('Journal entry')
      .fill(
        'I sat by the window as the light turned gold. I felt a small ache and a quiet gratitude at the same time.'
      );
    await expect(page.locator('.page-front .save-state')).toContainText(/Saved at|Saved locally/);

    // The rail says what it is reading and lets the writer pick an angle.
    await expect(page.locator('.companion-context')).toContainText('Reading this page');
    const lensRow = page.locator('.lens-row');
    await expect(lensRow.getByRole('button')).toHaveCount(4);
    const directLens = lensRow.getByRole('button', { name: 'Direct', exact: true });
    await directLens.click();
    await expect(directLens).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.reflection-block .section-label')).toContainText('A direct question');

    await page
      .locator('.companion-card')
      .getByRole('button', { name: 'Reflect with companion' })
      .click();
    // The finished question opens the answer box; dismiss it here so the rest
    // of the after-writing flow can be exercised.
    const answerDialog = page.getByRole('dialog');
    await expect(answerDialog).toBeVisible({ timeout: 60_000 });
    await expect(answerDialog).toContainText('?');
    await answerDialog.getByRole('button', { name: 'Not now' }).click();
    await expect(answerDialog).toHaveCount(0);
    const finishedReflection = page.locator('.reflection-quote:not(.is-streaming)');
    await expect(finishedReflection).toBeVisible({ timeout: 60_000 });
    await expect(finishedReflection).toContainText('?');
    await expect(page.locator('.companion-status')).toContainText('Online');

    // The pill stays simple; the info button reveals the runtime details.
    await page.locator('.companion-info').hover();
    const companionDetails = page.locator('.companion-status-tooltip');
    await expect(companionDetails).toBeVisible();
    await expect(companionDetails).toContainText('Processor');
    await expect(companionDetails).toContainText(/threads/i);
    await expect(companionDetails).toContainText('Model');

    const overview = page.locator('.overview-pane');
    await expect(overview).toBeHidden();
    // The companion click moved the pointer away, so the page may be resting.
    await page.mouse.move(760, 420);
    await expect(page.locator('.page-flip')).not.toHaveClass(/is-covered/);
    await page.getByRole('button', { name: 'Finish page' }).click();
    await expect(overview).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How did this page feel?' })).toBeVisible({
      timeout: 90_000
    });

    const moodReadout = overview.locator('.mood-readout');
    await expect(moodReadout).toBeVisible();
    await overview.getByRole('button', { name: /Mood 8 of 10/ }).click();
    await expect(moodReadout).toContainText('8');
    await overview.getByRole('button', { name: /Continue to themes/ }).click();

    await expect(page.getByRole('heading', { name: 'What was this page about?' })).toBeVisible();
    await expect(overview.locator('.emotion-badge.is-filled')).toBeVisible({ timeout: 60_000 });
    await expect(overview.locator('.tag-cloud .tag-chip').first()).toBeVisible();
    await overview.getByRole('button', { name: /Continue to palette/ }).click();

    await expect(page.getByRole('heading', { name: 'What color was today?' })).toBeVisible();
    await expect(overview.locator('.palette-swatch')).toHaveCount(3, { timeout: 60_000 });
    await overview.getByRole('button', { name: /See the overview/ }).click();

    await expect(page.getByRole('heading', { name: 'Your page is complete.' })).toBeVisible();
    const rows = overview.locator('.overview-rows');
    await expect(rows).toContainText('Mood');
    await expect(rows).toContainText('8 / 10');
    await expect(rows).toContainText('Themes');
    await expect(rows).toContainText('Palette');

    await overview.locator('.overview-back').click();
    await expect(overview).toBeHidden();
    await expect(page.getByLabel('Entry title')).toHaveValue('Late afternoon');
    await expect(page.getByLabel('Journal entry')).toHaveValue(/small ache/);

    // Once mood, themes, and palette are settled, the footer shows a finished
    // status and a separate Review action.
    await expect(page.locator('.finish-status')).toContainText('Page finished');
    await expect(page.getByRole('button', { name: 'Page finished' })).toHaveCount(0);
    const reviewButton = page.getByRole('button', { name: 'Review' });
    await expect(reviewButton).toBeVisible();

    // Review opens step four (Overview) with the saved reading, without
    // re-reading the page or overwriting the mood picked earlier.
    await reviewButton.click();
    await expect(overview).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your page is complete.' })).toBeVisible();
    await expect(overview.locator('.overview-step.is-current')).toContainText('Overview');
    await expect(rows).toContainText('8 / 10');
    await expect(rows).toContainText('Themes');
    await expect(rows).toContainText('Palette');
    await overview.locator('.overview-back').click();
    await expect(overview).toBeHidden();

    const entry = await page.evaluate(async () => {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate()
      ).padStart(2, '0')}`;
      const response = await window.lichen.vault.get(date);
      return response.data.entry;
    });
    expect(entry.reflection).toMatch(/\?$/);
    expect(entry.summary).toBeTruthy();
    expect(entry.mood).toBe(8);
    expect(entry.primaryEmotion).toBeTruthy();
    expect(entry.tags.length).toBeGreaterThan(0);
    expect(entry.palette.hex_colors).toHaveLength(3);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('Review reopens a saved reading without re-reading the page', async () => {
  test.setTimeout(60_000);
  const userDataDir = makeUserDataDir();
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  const vault = new Vault({
    dbPath: path.join(userDataDir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
  vault.saveEntry({ date, title: 'Saved page', body: BODY });
  vault.applyMetadata(date, {
    summary: 'A quiet, hopeful page after the rain.',
    tags: ['moss', 'rain', 'quiet'],
    mood: 7,
    primary_emotion: 'hopeful'
  });
  vault.applyPalette(date, {
    hex_colors: ['#4f6b52', '#9db28f', '#e7e2d3'],
    vibe_name: 'quiet moss'
  });
  vault.close();

  const { app, page, errors } = await launchApp(userDataDir);
  try {
    await expect(page.locator('.finish-status')).toContainText('Page finished');
    await page.getByRole('button', { name: 'Review' }).click();

    // Opening Review must not trigger a fresh model pass, and it lands on
    // step four (Overview) rather than restarting the ritual.
    await expect(page.getByRole('heading', { name: 'Reading your page…' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Your page is complete.' })).toBeVisible();
    await expect(page.locator('.overview-step.is-current')).toContainText('Overview');
    const rows = page.locator('.overview-rows');
    await expect(rows).toContainText('7 / 10');
    await expect(rows).toContainText('Themes');
    await expect(rows).toContainText('Palette');
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('carries the last open question onto the next page', async () => {
  const userDataDir = makeUserDataDir();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const vault = new Vault({
    dbPath: path.join(userDataDir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
  vault.saveEntry({ date: yesterdayDate, title: 'Yesterday', body: BODY });
  vault.saveReflection(yesterdayDate, 'What did the quiet leave behind?');
  vault.close();

  const { app, page, errors } = await launchApp(userDataDir);
  try {
    const carried = page.locator('.carried-card');
    await expect(carried).toBeVisible();
    await expect(carried).toContainText('What did the quiet leave behind?');

    // It is only borrowed: dismissing it leaves the rail without it.
    await carried.getByRole('button', { name: 'Let it go' }).click();
    await expect(carried).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('saves and revisits a reflection answer on the page', async () => {
  test.setTimeout(90_000);
  const userDataDir = makeUserDataDir();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const question = 'What did the quiet leave behind?';
  const firstAnswer = 'It left a little more room to breathe.';
  const secondAnswer = 'It left room for a slower evening.';

  const vault = new Vault({
    dbPath: path.join(userDataDir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
  vault.saveEntry({ date: today, title: 'Today', body: BODY });
  vault.saveReflection(today, question);
  vault.close();

  let { app, page, errors } = await launchApp(userDataDir);
  try {
    const companion = page.locator('.companion-card');
    await expect(companion.locator('.reflection-quote:not(.is-streaming)')).toContainText(
      question
    );
    await companion.getByRole('button', { name: 'Write an answer' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.reflection-answer-question')).toContainText(question);
    await dialog.getByLabel('Your answer').fill(firstAnswer);
    await dialog.getByRole('button', { name: 'Save reflection' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.toast-success')).toContainText('Reflection saved');

    // Return to the writing page before reading the nested section.
    await page.mouse.move(760, 420);
    await expect(page.locator('.page-flip')).not.toHaveClass(/is-covered/);
    const reflections = page.locator('.page-reflections');
    await expect(reflections).toBeVisible();
    await expect(reflections.locator('.page-reflection-question')).toContainText(question);
    await expect(reflections.locator('.page-reflection-answer')).toContainText(firstAnswer);

    const stored = await page.evaluate(async (date) => {
      const response = await window.lichen.vault.get(date);
      return response.data.entry;
    }, today);
    expect(stored.reflections).toHaveLength(1);
    expect(stored.reflections[0].answer).toBe(firstAnswer);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
  }

  ({ app, page, errors } = await launchApp(userDataDir));
  try {
    await page.mouse.move(760, 420);
    await expect(page.locator('.page-flip')).not.toHaveClass(/is-covered/);
    const reflections = page.locator('.page-reflections');
    await expect(reflections.locator('.page-reflection-answer')).toContainText(firstAnswer);
    await reflections.getByRole('button', { name: 'Edit answer' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Your answer')).toHaveValue(firstAnswer);
    await dialog.getByLabel('Your answer').fill(secondAnswer);
    await dialog.getByRole('button', { name: 'Update reflection' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.toast-success')).toContainText('Reflection updated');

    await expect(reflections.locator('.page-reflection')).toHaveCount(1);
    await expect(reflections.locator('.page-reflection-answer')).toContainText(secondAnswer);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('deletes a page after confirmation', async () => {
  test.setTimeout(90_000);
  const userDataDir = makeUserDataDir();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  const vault = new Vault({
    dbPath: path.join(userDataDir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
  vault.saveEntry({ date: today, title: 'Temporary page', body: BODY });
  vault.applyMetadata(today, {
    summary: 'A quiet page kept for a moment.',
    tags: ['moss', 'rain'],
    mood: 6,
    primary_emotion: 'quiet',
    source: 'model'
  });
  vault.applyPalette(today, {
    hex_colors: ['#9dc3bb', '#cfe0d8', '#e9e3d2'],
    vibe_name: 'soothed',
    fallback: false
  });
  vault.saveReflection(today, 'What did the quiet leave behind?');
  vault.close();

  const { app, page, errors } = await launchApp(userDataDir);
  try {
    // A saved palette now draws the full accent frame around the page.
    await expect(page.locator('.editor-card').first()).toHaveClass(/has-accent/);
    const deleteButton = page.locator('.delete-page');
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Delete this page?');
    await expect(dialog).toContainText('Temporary page');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Entry title')).toHaveValue('Temporary page');

    await page.locator('.delete-page').click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Delete page' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.toast-success')).toContainText('Page deleted');
    await expect(page.getByLabel('Entry title')).toHaveValue('');
    await expect(page.getByLabel('Journal entry')).toHaveValue('');

    const stored = await page.evaluate(async (date) => {
      const response = await window.lichen.vault.get(date);
      return response.data.entry;
    }, today);
    expect(stored).toBeNull();
    await expect(page.locator('.entry-row', { hasText: 'Temporary page' })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('enters and leaves minimal writing mode', async () => {
  test.setTimeout(60_000);
  const userDataDir = makeUserDataDir();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const question = 'What did the quiet leave behind?';

  const vault = new Vault({
    dbPath: path.join(userDataDir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
  vault.saveEntry({ date: today, title: 'Minimal page', body: BODY });
  vault.saveReflection(today, question);
  vault.saveReflectionAnswer(today, question, 'Room to breathe.');
  vault.close();

  const { app, page, errors } = await launchApp(userDataDir);
  try {
    const shell = page.locator('.app-shell');
    await expect(shell).not.toHaveClass(/is-minimal/);

    await page.getByRole('button', { name: 'Enter minimal writing mode' }).click();
    await expect(shell).toHaveClass(/is-minimal/);
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('.companion-pane')).toBeHidden();
    await expect(page.locator('.editor-head')).toBeHidden();
    await expect(page.locator('.editor-foot')).toBeHidden();
    await expect(page.locator('.page-reflections')).toBeHidden();
    await expect(page.locator('.security-badge')).toBeHidden();
    await expect(page.locator('.settings-toggle')).toBeHidden();
    await expect(page.getByLabel('Entry title')).toBeVisible();
    await expect(page.getByLabel('Journal entry')).toBeVisible();

    // The privacy page-turn still works while minimal mode is on. Enter the
    // page first so the pointer actually crosses its boundary when leaving.
    await page.mouse.move(760, 420);
    await expect(page.locator('.page-flip')).not.toHaveClass(/is-covered/);
    await page.mouse.move(4, 4);
    await expect(page.locator('.page-flip')).toHaveClass(/is-covered/, { timeout: 5000 });
    await page.mouse.move(760, 420);
    await expect(page.locator('.page-flip')).not.toHaveClass(/is-covered/);

    await page.keyboard.press('Escape');
    await expect(shell).not.toHaveClass(/is-minimal/);
    await expect(page.locator('.sidebar')).toBeVisible();

    await page.getByRole('button', { name: 'Enter minimal writing mode' }).click();
    await expect(shell).toHaveClass(/is-minimal/);
    await page.getByRole('button', { name: 'Leave minimal writing mode' }).click();
    await expect(shell).not.toHaveClass(/is-minimal/);
    await expect(page.locator('.sidebar')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('rail admits when a reading fell back locally', async () => {
  test.setTimeout(60_000);
  const userDataDir = makeUserDataDir();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  const vault = new Vault({
    dbPath: path.join(userDataDir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
  vault.saveEntry({ date: today, title: 'Today', body: BODY });
  vault.applyMetadata(today, {
    summary: BODY,
    tags: ['moss', 'rain'],
    mood: null,
    primary_emotion: 'reflective',
    anchors: [],
    source: 'fallback'
  });
  vault.applyPalette(today, {
    hex_colors: ['#6c7480', '#9aa2ad', '#dfe2e6'],
    vibe_name: 'low cloud',
    fallback: true
  });
  vault.close();

  const { app, page, errors } = await launchApp(userDataDir);
  try {
    const thisPage = page.locator('.this-page-card');
    await expect(thisPage.locator('.page-note')).toContainText(
      "The companion couldn't finish reading this page."
    );
    await expect(thisPage.locator('.page-vibe-note')).toContainText('local tint');
    await expect(thisPage.locator('.page-empty')).toContainText('Not read yet.');

    // Recovery routes into the reading ritual rather than duplicating it.
    await thisPage.getByRole('button', { name: 'Read again' }).click();
    await expect(page.locator('.overview-pane')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('rail shows the last three weeks and older pages', async () => {
  test.setTimeout(60_000);
  const userDataDir = makeUserDataDir();
  const isoDay = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
  const daysAgo = (count) => {
    const date = new Date();
    date.setDate(date.getDate() - count);
    return isoDay(date);
  };
  const shiftMonthClamp = (months) => {
    const now = new Date();
    const day = now.getDate();
    const target = new Date(now.getFullYear(), now.getMonth() + months, 1, 12);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
    target.setDate(Math.min(day, lastDay));
    return isoDay(target);
  };
  const today = isoDay(new Date());
  const threeDaysAgo = daysAgo(3);
  const monthAgo = shiftMonthClamp(-1);
  const yearAgo = shiftMonthClamp(-12);

  const vault = new Vault({
    dbPath: path.join(userDataDir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
  vault.saveEntry({ date: today, title: 'Today', body: BODY });
  vault.applyMetadata(today, {
    summary: 'Moss after rain.',
    mood: 7,
    primary_emotion: 'hopeful',
    tags: ['moss', 'river'],
    anchors: ['The moss by the river was bright after the rain.'],
    source: 'model'
  });
  vault.applyPalette(today, {
    hex_colors: ['#7d8f6a', '#a8b79a', '#e4e8d8'],
    vibe_name: 'river hush'
  });
  vault.saveEntry({ date: threeDaysAgo, title: 'Older', body: 'A grey afternoon by the window.' });
  vault.applyMetadata(threeDaysAgo, { mood: 4, primary_emotion: 'tired' });
  vault.applyPalette(threeDaysAgo, {
    hex_colors: ['#6c7480', '#9aa2ad', '#dfe2e6'],
    vibe_name: 'low cloud'
  });
  vault.saveEntry({ date: monthAgo, title: 'A month ago', body: 'The same walk, a different mood.' });
  vault.saveEntry({ date: yearAgo, title: 'A year ago', body: 'The first page of the year.' });
  vault.close();

  const { app, page, errors } = await launchApp(userDataDir);
  try {
    const weather = page.locator('.weather-block');
    await expect(weather).toBeVisible();
    await expect(weather.locator('.weather-tick')).toHaveCount(21);
    await expect(weather.locator('.weather-caption')).toContainText('2 of 21 days');

    const thisPage = page.locator('.this-page-card');
    await expect(thisPage).toContainText('hopeful');
    await expect(thisPage).toContainText('moss');
    await expect(thisPage).toContainText('river hush');
    await expect(thisPage.locator('.page-anchor')).toHaveCount(1);
    await expect(thisPage.locator('.page-anchor')).toContainText('moss by the river');
    await expect(thisPage.locator('.page-note')).toHaveCount(0);
    await expect(thisPage.locator('.page-mood-value')).toContainText(/7\s*\/\s*10/);

    await thisPage.getByRole('button', { name: 'Raise mood by one' }).click();
    await expect(thisPage.locator('.page-mood-value')).toContainText(/8\s*\/\s*10/);

    const older = page.locator('.on-this-day');
    await expect(older).toContainText('A month ago');
    await expect(older).toContainText('A year ago');
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('Finish page reads a page before any reflection has loaded the model', async () => {
  test.setTimeout(120_000);
  if (!hasCompanionModel()) {
    test.skip();
    return;
  }
  const userDataDir = makeUserDataDir();
  const { app, page, errors } = await launchApp(userDataDir);
  try {
    await page.getByRole('button', { name: /Begin today's entry/ }).click();
    await page.getByLabel('Entry title').fill('First read');
    await page
      .getByLabel('Journal entry')
      .fill(
        'The rain stopped and the garden smelled of moss and iron. I felt tired, then quietly relieved.'
      );
    await expect(page.locator('.page-front .save-state')).toContainText(/Saved at|Saved locally/);

    // No reflection first: this used to build the JSON grammar before the model
    // had loaded, then leave the overview stuck on "Reading your page…".
    await page.getByRole('button', { name: 'Finish page' }).click();
    await expect(page.getByRole('heading', { name: 'How did this page feel?' })).toBeVisible({
      timeout: 90_000
    });
    await expect(page.locator('.overview-warning')).toHaveCount(0);

    const entry = await page.evaluate(async () => {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate()
      ).padStart(2, '0')}`;
      const response = await window.lichen.vault.get(date);
      return response.data.entry;
    });
    expect(entry.summary).toBeTruthy();
    expect(entry.primaryEmotion).toBeTruthy();
    expect(entry.mood).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('preferences change the palette, page-turn, and motion and persist', async () => {
  test.setTimeout(90_000);
  const userDataDir = makeUserDataDir();
  let { app, page, errors } = await launchApp(userDataDir);
  try {
    await page.getByRole('button', { name: /Begin today's entry/ }).click();
    await page.getByLabel('Entry title').fill('Preferences');
    await page.getByLabel('Journal entry').fill(BODY);
    await expect(page.locator('.page-front .save-state')).toContainText(/Saved at|Saved locally/);

    await page.getByRole('button', { name: 'Open vault settings' }).click();
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();

    await page.getByRole('button', { name: /River/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'river');
    const riverBackground = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(riverBackground).toBe('#e9edee');

    await page.getByRole('checkbox', { name: /Flip the page when you step away/ }).uncheck();
    await page.getByRole('checkbox', { name: /Reduce motion/ }).check();
    await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'true');
    await page.getByRole('button', { name: 'Done' }).click();

    // With the page-turn off, leaving the page no longer covers it.
    await page.mouse.move(4, 4);
    await page.waitForTimeout(900);
    await expect(page.locator('.page-flip')).not.toHaveClass(/is-covered/);
    expect(errors).toEqual([]);

    await app.close();
    ({ app, page, errors } = await launchApp(userDataDir));
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'river');
    await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'true');

    await page.getByRole('button', { name: 'Open vault settings' }).click();
    await expect(
      page.getByRole('checkbox', { name: /Flip the page when you step away/ })
    ).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Reduce motion/ })).toBeChecked();
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('the page turns private when the pointer leaves and returns on hover or typing', async () => {
  test.setTimeout(90_000);
  const userDataDir = makeUserDataDir();
  const { app, page, errors } = await launchApp(userDataDir);
  try {
    await page.getByRole('button', { name: /Begin today's entry/ }).click();
    await page.getByLabel('Entry title').fill('Private page');
    await page.getByLabel('Journal entry').fill(BODY);
    await expect(page.locator('.page-front .save-state')).toContainText(/Saved at|Saved locally/);

    await page.getByLabel('Search journal entries').click();
    await page.mouse.move(4, 4);
    await expect(page.locator('.page-flip')).toHaveClass(/is-covered/);

    await page.mouse.move(700, 400);
    await expect(page.locator('.page-flip')).not.toHaveClass(/is-covered/);
    await expect(page.getByLabel('Journal entry')).toHaveValue(BODY);

    await page.getByLabel('Journal entry').click();
    await page.mouse.move(4, 4);
    await expect(page.locator('.page-flip')).not.toHaveClass(/is-covered/);
    await page.waitForTimeout(5000);
    await expect(page.locator('.page-flip')).toHaveClass(/is-covered/);

    await page.keyboard.type('x');
    await expect(page.locator('.page-flip')).not.toHaveClass(/is-covered/);
    await expect(page.getByLabel('Journal entry')).toHaveValue(`${BODY}x`);

    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('adds a page from a photo without replacing existing words', async () => {
  test.setTimeout(240_000);
  const ocrModel = path.join(ROOT, 'models', 'MiniCPM-OCR-1_0-Q4_K_M.gguf');
  const ocrProjector = path.join(ROOT, 'models', 'mmproj-model-f16-4x.gguf');
  const ocrBinary = path.join(
    ROOT,
    'vendor',
    'llama',
    `${process.platform}-${process.arch}`,
    process.platform === 'win32' ? 'llama-mtmd-cli.exe' : 'llama-mtmd-cli'
  );
  test.skip(
    !fs.existsSync(ocrModel) || !fs.existsSync(ocrProjector) || !fs.existsSync(ocrBinary),
    'OCR model and runtime are not installed'
  );

  const userDataDir = makeUserDataDir();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const vault = new Vault({
    dbPath: path.join(userDataDir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
  vault.saveEntry({ date: today, title: 'Existing page', body: 'Existing words.' });
  vault.close();

  const fixture = path.join(ROOT, 'tests', 'fixtures', 'ocr-journal-page.png');
  const { app, page, errors } = await launchApp(userDataDir);
  try {
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, fixture);

    await page.getByRole('button', { name: 'Add a page from a photo' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Bring a page into the journal' })
    ).toBeVisible();
    await expect(page.getByText('This day already has words.', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Choose a photo' }).click();
    await expect(page.getByAltText('Selected page preview')).toBeVisible();
    await page.getByRole('button', { name: 'Read this page' }).click();

    const textarea = page.getByLabel('Check the words before saving');
    await expect(textarea).toHaveValue(/LICHEN|river/i, { timeout: 180_000 });
    await page.getByRole('button', { name: 'Add to journal' }).click();

    await expect(
      page.getByText(/Photo text added below this page|Page added from photo/)
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel('Entry title')).toHaveValue('Existing page');
    const body = await page.getByLabel('Journal entry').inputValue();
    expect(body).toContain('Existing words.');
    expect(body).toMatch(/LICHEN JOURNAL/i);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});


test('keeps first-run setup on the processor when the video-card check fails', async () => {
  test.setTimeout(120_000);
  const userDataDir = makeUserDataDir();
  const modelDir = fs.mkdtempSync(path.join(ROOT, '.e2e-models-'));
  const bodies = {
    '/companion': Buffer.from('companion-model-'.repeat(200)),
    '/ocr': Buffer.from('ocr-model-'.repeat(200)),
    '/projector': Buffer.from('projector-'.repeat(200))
  };
  const { server, base } = await startModelServer(bodies);
  const manifest = [
    {
      id: 'companion',
      label: 'Companion',
      file: 'MiniCPM-V-4_7-1B-Q4_K_M.gguf',
      bytes: bodies['/companion'].length,
      sha256: crypto.createHash('sha256').update(bodies['/companion']).digest('hex'),
      url: `${base}/companion`
    },
    {
      id: 'ocrModel',
      label: 'Photo reader',
      file: 'MiniCPM-OCR-1_0-Q4_K_M.gguf',
      bytes: bodies['/ocr'].length,
      sha256: crypto.createHash('sha256').update(bodies['/ocr']).digest('hex'),
      url: `${base}/ocr`
    },
    {
      id: 'ocrProjector',
      label: 'Vision projector',
      file: 'mmproj-model-f16-4x.gguf',
      bytes: bodies['/projector'].length,
      sha256: crypto.createHash('sha256').update(bodies['/projector']).digest('hex'),
      url: `${base}/projector`
    }
  ];

  const { app, page, errors } = await launchApp(userDataDir, {
    LICHEN_MODEL_DIR: modelDir,
    LICHEN_MODEL_TEST_MANIFEST: JSON.stringify(manifest)
  }, { dismissModelSetup: false });
  try {
    await expect(
      page.getByRole('heading', { name: 'Set up the extras' })
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Download the extras' }).click();
    await expect(
      page.getByRole('heading', { name: "You're all set." })
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole('radio', { name: /Use my video card/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Continue with the standard setting' })).toBeVisible({
      timeout: 90_000
    });
    await expect(page.locator('.compute-status')).toContainText(/standard setting/i);
    await page.getByRole('button', { name: 'Continue with the standard setting' }).click();
    await expect(
      page.getByRole('heading', { name: "You're all set." })
    ).toHaveCount(0);
    const settings = JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8'));
    expect(settings.compute.mode).toBe('cpu');
    expect(settings.compute.choiceMade).toBe(true);
    expect(settings.compute.lastError.message).toMatch(/processor/i);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(modelDir, { recursive: true, force: true });
  }
});

test('offers model setup on first run and keeps journaling available', async () => {
  test.setTimeout(90_000);
  const userDataDir = makeUserDataDir();
  const modelDir = fs.mkdtempSync(path.join(ROOT, '.e2e-models-'));
  const { app, page, errors } = await launchApp(userDataDir, {
    LICHEN_MODEL_DIR: modelDir
  }, { dismissModelSetup: false });
  try {
    await expect(
      page.getByRole('heading', { name: 'Set up the extras' })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('need a one-time download', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(
      page.getByRole('heading', { name: 'Set up the extras' })
    ).toHaveCount(0);

    await page.getByRole('button', { name: /Begin today's entry/ }).click();
    await page.getByLabel('Entry title').fill('Offline first');
    await page.getByLabel('Journal entry').fill(BODY);
    await expect(page.locator('.page-front .save-state')).toContainText(/Saved at|Saved locally/);

    await page.getByRole('button', { name: 'Open vault settings' }).click();
    await expect(page.getByRole('heading', { name: 'Local companion' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Photo pages' })).toBeVisible();
    await expect(page.locator('.model-asset-state').filter({ hasText: 'Not downloaded' })).toHaveCount(3);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(modelDir, { recursive: true, force: true });
  }
});


test('downloads the model setup queue and installs verified files', async () => {
  test.setTimeout(90_000);
  const userDataDir = makeUserDataDir();
  const modelDir = fs.mkdtempSync(path.join(ROOT, '.e2e-models-'));
  const bodies = {
    '/companion': Buffer.from('companion-model-'.repeat(200)),
    '/ocr': Buffer.from('ocr-model-'.repeat(200)),
    '/projector': Buffer.from('projector-'.repeat(200))
  };
  const { server, base } = await startModelServer(bodies);
  const manifest = [
    {
      id: 'companion',
      label: 'Companion',
      file: 'MiniCPM-V-4_7-1B-Q4_K_M.gguf',
      bytes: bodies['/companion'].length,
      sha256: crypto.createHash('sha256').update(bodies['/companion']).digest('hex'),
      url: `${base}/companion`
    },
    {
      id: 'ocrModel',
      label: 'Photo reader',
      file: 'MiniCPM-OCR-1_0-Q4_K_M.gguf',
      bytes: bodies['/ocr'].length,
      sha256: crypto.createHash('sha256').update(bodies['/ocr']).digest('hex'),
      url: `${base}/ocr`
    },
    {
      id: 'ocrProjector',
      label: 'Vision projector',
      file: 'mmproj-model-f16-4x.gguf',
      bytes: bodies['/projector'].length,
      sha256: crypto.createHash('sha256').update(bodies['/projector']).digest('hex'),
      url: `${base}/projector`
    }
  ];

  const { app, page, errors } = await launchApp(userDataDir, {
    LICHEN_MODEL_DIR: modelDir,
    LICHEN_MODEL_TEST_MANIFEST: JSON.stringify(manifest)
  }, { dismissModelSetup: false });
  try {
    await expect(
      page.getByRole('heading', { name: 'Set up the extras' })
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Download the extras' }).click();
    await expect(
      page.getByRole('heading', { name: "You're all set." })
    ).toBeVisible({ timeout: 30_000 });
    expect(fs.readFileSync(path.join(modelDir, manifest[0].file))).toEqual(bodies['/companion']);
    expect(fs.readFileSync(path.join(modelDir, manifest[1].file))).toEqual(bodies['/ocr']);
    expect(fs.readFileSync(path.join(modelDir, manifest[2].file))).toEqual(bodies['/projector']);

    // The optional performance choice is the last step of first-run setup.
    await expect(page.getByText('Want faster answers?')).toBeVisible();
    const processorChoice = page.getByRole('radio', { name: /Use the standard setting/ });
    await expect(processorChoice).toBeChecked();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: "You're all set." })
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(modelDir, { recursive: true, force: true });
  }
});


test('developer reset clears all data or keeps models with mock entries', async () => {
  test.setTimeout(90_000);
  const userDataDir = makeUserDataDir();
  const modelDir = fs.mkdtempSync(path.join(ROOT, '.e2e-models-'));
  const bodies = {
    '/companion': Buffer.from('companion-model-'.repeat(200)),
    '/ocr': Buffer.from('ocr-model-'.repeat(200)),
    '/projector': Buffer.from('projector-'.repeat(200))
  };
  const manifest = [
    {
      id: 'companion',
      label: 'Companion',
      file: 'MiniCPM-V-4_7-1B-Q4_K_M.gguf',
      bytes: bodies['/companion'].length,
      sha256: crypto.createHash('sha256').update(bodies['/companion']).digest('hex'),
      url: 'https://example.invalid/companion'
    },
    {
      id: 'ocrModel',
      label: 'Photo reader',
      file: 'MiniCPM-OCR-1_0-Q4_K_M.gguf',
      bytes: bodies['/ocr'].length,
      sha256: crypto.createHash('sha256').update(bodies['/ocr']).digest('hex'),
      url: 'https://example.invalid/ocr'
    },
    {
      id: 'ocrProjector',
      label: 'Vision projector',
      file: 'mmproj-model-f16-4x.gguf',
      bytes: bodies['/projector'].length,
      sha256: crypto.createHash('sha256').update(bodies['/projector']).digest('hex'),
      url: 'https://example.invalid/projector'
    }
  ];
  for (const asset of manifest) {
    const body =
      asset.id === 'companion'
        ? bodies['/companion']
        : asset.id === 'ocrModel'
          ? bodies['/ocr']
          : bodies['/projector'];
    fs.writeFileSync(path.join(modelDir, asset.file), body);
  }
  fs.writeFileSync(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({
      version: 1,
      compute: {
        mode: 'gpu',
        choiceMade: true,
        verified: true,
        backend: 'vulkan',
        lastError: null,
        updatedAt: '2026-11-11T00:00:00.000Z'
      }
    })
  );

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const vault = new Vault({
    dbPath: path.join(userDataDir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
  vault.saveEntry({ date: today, title: 'Existing entry', body: 'Existing words.' });
  vault.close();

  const { app, page, errors } = await launchApp(userDataDir, {
    LICHEN_MODEL_DIR: modelDir,
    LICHEN_MODEL_TEST_MANIFEST: JSON.stringify(manifest)
  }, { dismissModelSetup: false });
  try {
    const freshButton = page.getByRole('button', { name: 'Reset app (developer tool)' });
    const mockButton = page.getByRole('button', { name: 'Reset app with mock data (developer tool)' });
    await expect(freshButton).toBeVisible();
    await expect(mockButton).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Set up the extras' })
    ).toHaveCount(0);

    await mockButton.click();
    await expect(page.getByRole('heading', { name: 'Reset and load mock data?' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset and load mock data', exact: true }).click();
    await expect(page.getByLabel('Entry title')).toHaveValue('Moss after the rain', {
      timeout: 30_000
    });
    await expect(page.getByText('Existing entry')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Set up the extras' })
    ).toHaveCount(0);
    for (const asset of manifest) {
      expect(fs.existsSync(path.join(modelDir, asset.file))).toBe(true);
    }
    const keptSettings = JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8'));
    expect(keptSettings.compute).toMatchObject({
      mode: 'gpu',
      choiceMade: true,
      verified: true,
      backend: 'vulkan'
    });

    await page.getByRole('button', { name: 'Enter minimal writing mode' }).click();
    await expect(page.locator('.header-dev-tools')).toBeHidden();
    await page.getByRole('button', { name: 'Leave minimal writing mode' }).click();
    await expect(page.locator('.header-dev-tools')).toBeVisible();

    await freshButton.click();
    await expect(page.getByRole('heading', { name: 'Reset the app?' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset everything', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Set up the extras' })
    ).toBeVisible({ timeout: 30_000 });
    for (const asset of manifest) {
      expect(fs.existsSync(path.join(modelDir, asset.file))).toBe(false);
    }
    const capabilities = computeCapabilities(process.platform, process.arch);
    const resetSettings = JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8')
    );
    expect(resetSettings.compute).toMatchObject({
      mode: capabilities.canChooseGpu ? capabilities.defaultMode : capabilities.fixedMode,
      choiceMade: !capabilities.canChooseGpu,
      verified: false,
      backend: null,
      lastError: null
    });

    await app.close();
    const checkVault = new Vault({
      dbPath: path.join(userDataDir, 'vault', 'lichen_journal.sqlite'),
      appVersion: 'test'
    });
    checkVault.init();
    expect(checkVault.getStats().entryCount).toBe(0);
    checkVault.close();
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(modelDir, { recursive: true, force: true });
  }
});
