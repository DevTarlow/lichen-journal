import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(ROOT, 'screenshots');
const USER_DATA_DIR = path.join(os.tmpdir(), 'lichen-journal-screenshots');
const MODEL_DIR = path.join(USER_DATA_DIR, 'models');
const VIEWPORT = { width: 1440, height: 883 };

const { Vault } = require('../src/main/db.js');
const { seedMockJournal } = require('../src/main/dev-mock-data.js');

function seedVault() {
  const vault = new Vault({
    dbPath: path.join(USER_DATA_DIR, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'screenshots'
  });
  vault.init();
  seedMockJournal(vault);
  vault.close();
}

async function setTheme(page, theme) {
  const current = await page.evaluate(() => document.documentElement.dataset.theme);
  if (current === theme) return;
  await page.locator('.theme-toggle').click();
  await page.waitForFunction(
    (wanted) => document.documentElement.dataset.theme === wanted,
    theme
  );
}

async function settle(page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  await page.waitForTimeout(250);
}

async function capture(page, name) {
  const buffer = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const optimized = await sharp(buffer)
    .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 })
    .toBuffer();
  fs.writeFileSync(path.join(SHOTS_DIR, name), optimized);
  const sizeKb = Math.round(optimized.length / 1024);
  console.log(`screenshots/${name} (${sizeKb} KB)`);
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('Build the renderer first: npm run build');
  }
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  seedVault();

  const app = await electron.launch({
    args: [
      `--user-data-dir=${USER_DATA_DIR}`,
      '--disable-gpu',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--no-sandbox',
      '.'
    ],
    cwd: ROOT,
    env: {
      ...process.env,
      LICHEN_USER_DATA_DIR: USER_DATA_DIR,
      LICHEN_MODEL_DIR: MODEL_DIR,
      LICHEN_DEVTOOLS: '0',
      LICHEN_ENABLE_GPU: '0',
      ELECTRON_OZONE_PLATFORM_HINT: 'x11'
    }
  });

  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.app-header', { timeout: 45_000 });
    await page.setViewportSize(VIEWPORT);

    const setup = page.getByTestId('model-setup');
    await setup.waitFor({ state: 'visible', timeout: 20_000 });
    await settle(page);
    await capture(page, 'lichen-model-setup.png');
    await page.getByTestId('model-setup-not-now').click();
    await setup.waitFor({ state: 'hidden' });

    await setTheme(page, 'light');
    await page.getByLabel('Entry title').waitFor({ state: 'visible' });
    await settle(page);
    await capture(page, 'lichen-light.png');

    await setTheme(page, 'dark');
    await page.locator('.review-page').click();
    await page
      .getByRole('heading', { name: 'Your page is complete.' })
      .waitFor({ state: 'visible', timeout: 30_000 });
    await settle(page);
    await capture(page, 'lichen-dark.png');

    await page.getByRole('button', { name: 'Back to page' }).first().click();
    await page.getByRole('button', { name: 'Open vault settings' }).click();
    await page.getByRole('heading', { name: 'Vault settings' }).waitFor({
      state: 'visible'
    });
    await settle(page);
    await capture(page, 'lichen-settings.png');

    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Add a page from a photo' }).click();
    await page
      .getByRole('heading', { name: 'Bring a page into the journal' })
      .waitFor({ state: 'visible' });
    await settle(page);
    await capture(page, 'lichen-photo-import.png');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
