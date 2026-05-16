import fs from 'fs';
import path from 'path';
import { launchChromium } from './playwright-check.js';

/**
 * Fetches Sora post pages as HTML using Playwright with JS disabled — the
 * only known way to bypass the sunset redirect now that the live site is
 * gone. The SSR HTML still contains the RSC payload (`__next_f.push`) with
 * fresh signed Azure URLs that asset downloads can use for ~7 days.
 *
 * Replace policy (per the design Q&A):
 *   - No existing file        -> always fetch.
 *   - File mtime < 7 days old -> skip (the URLs in it haven't expired yet).
 *   - File mtime >= 7 days    -> try to refresh:
 *       * On success  -> archive the old file under _refresh/archive/<date>/
 *                        then write the new content.
 *       * On failure  -> keep the original untouched. The user can clean up
 *                        the archive folder later if they want.
 *
 * "Success" requires:
 *   1. HTTP status < 400, AND
 *   2. The response body contains `__next_f` (otherwise we got the sunset
 *      page or a generic error page that would overwrite good data).
 */

const runtimeImport = Function('specifier', 'return import(specifier)');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SUNSET_HINTS = ['sunset', 'no longer available'];
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function urlToFilename(url) {
  try {
    const u = new URL(url);
    const slug = u.pathname.replace(/^\//, '').replace(/\//g, '_') || 'index';
    return `${slug}.html`;
  } catch {
    return `page_${Date.now()}.html`;
  }
}

function ageMs(file) {
  try {
    const stat = fs.statSync(file);
    return Date.now() - stat.mtimeMs;
  } catch {
    return Infinity;
  }
}

function archiveOldFile(htmlFile, archiveDir) {
  if (!fs.existsSync(htmlFile)) return null;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(archiveDir, dateStamp);
  fs.mkdirSync(dest, { recursive: true });
  const baseName = path.basename(htmlFile);
  // Avoid collisions if the same file is archived multiple times in one day.
  let target = path.join(dest, baseName);
  let i = 1;
  while (fs.existsSync(target)) {
    target = path.join(dest, baseName.replace(/\.html$/i, `.${i}.html`));
    i++;
  }
  fs.renameSync(htmlFile, target);
  return target;
}

function readUrls(linksFile) {
  if (!fs.existsSync(linksFile)) return [];
  return fs.readFileSync(linksFile, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.startsWith('http'));
}

/**
 * Decide what to do with one URL given current disk state and the age policy.
 * Pure function so it can be unit-tested without launching Playwright.
 *
 * Returns one of: 'skip-fresh' | 'fetch-new' | 'fetch-refresh'
 */
export function decideAction(htmlFile, { now = Date.now(), maxAgeMs = SEVEN_DAYS_MS } = {}) {
  if (!fs.existsSync(htmlFile)) return 'fetch-new';
  const age = (() => {
    try { return now - fs.statSync(htmlFile).mtimeMs; } catch { return Infinity; }
  })();
  return age < maxAgeMs ? 'skip-fresh' : 'fetch-refresh';
}

/**
 * Run the fetch step.
 *
 * @param {object} opts
 * @param {string} opts.linksFile    Path to clean-links.txt (one URL per line).
 * @param {string} opts.htmlDir      Output directory for fetched HTML files.
 * @param {string} opts.archiveDir   Directory where superseded HTML is moved.
 * @param {object} [opts.callbacks]  { onProgress(state), shouldCancel() }
 * @param {number} [opts.delayMs=1500]  Per-URL polite delay.
 * @param {number} [opts.maxAgeMs]   Override the 7-day refresh threshold.
 *
 * Returns a stats object summarising what happened.
 */
export async function fetchHtmlBatch(opts) {
  const {
    linksFile,
    htmlDir,
    archiveDir,
    callbacks = {},
    delayMs = 1500,
    maxAgeMs = SEVEN_DAYS_MS,
  } = opts;

  const stats = {
    total: 0,
    fetchedNew: 0,
    refreshed: 0,
    skippedFresh: 0,
    failed: 0,
    sunset: 0,
    keptOriginal: 0,
    archived: 0,
    errors: [],
  };

  const onProgress = typeof callbacks.onProgress === 'function' ? callbacks.onProgress : () => {};
  const shouldCancel = typeof callbacks.shouldCancel === 'function' ? callbacks.shouldCancel : () => false;

  const urls = readUrls(linksFile);
  stats.total = urls.length;
  if (!urls.length) return stats;

  fs.mkdirSync(htmlDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  let playwright;
  try {
    playwright = await runtimeImport('playwright');
  } catch (e) {
    throw new Error(`Playwright is not installed: ${e.message}`);
  }

  const browser = await launchChromium(playwright);
  let context;
  try {
    context = await browser.newContext({
      javaScriptEnabled: false,
      userAgent: USER_AGENT,
      extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
    });

    for (let i = 0; i < urls.length; i++) {
      if (shouldCancel()) break;
      const url = urls[i];
      const filename = urlToFilename(url);
      const outPath = path.join(htmlDir, filename);
      const decision = decideAction(outPath, { maxAgeMs });

      if (decision === 'skip-fresh') {
        stats.skippedFresh++;
        onProgress({ index: i, total: urls.length, url, decision, status: 'skipped' });
        continue;
      }

      const isRefresh = decision === 'fetch-refresh';
      let page;
      try {
        page = await context.newPage();
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const status = response?.status() ?? 0;

        if (status >= 400) {
          stats.failed++;
          if (isRefresh) stats.keptOriginal++;
          stats.errors.push({ url, error: `HTTP ${status}` });
          onProgress({ index: i, total: urls.length, url, decision, status: 'failed', httpStatus: status });
          continue;
        }

        const html = await page.content();
        const hasSoraData = html.includes('__next_f');
        const lower = html.toLowerCase();
        const isSunset = !hasSoraData && SUNSET_HINTS.some((h) => lower.includes(h));

        if (!hasSoraData) {
          stats.failed++;
          if (isSunset) stats.sunset++;
          if (isRefresh) stats.keptOriginal++;
          stats.errors.push({ url, error: isSunset ? 'sunset/redirect page' : 'no RSC payload' });
          onProgress({ index: i, total: urls.length, url, decision, status: 'failed', sunset: isSunset });
          continue;
        }

        if (isRefresh) {
          const archived = archiveOldFile(outPath, archiveDir);
          if (archived) stats.archived++;
        }
        fs.writeFileSync(outPath, html, 'utf8');

        if (isRefresh) stats.refreshed++;
        else stats.fetchedNew++;

        onProgress({ index: i, total: urls.length, url, decision, status: 'ok', size: html.length, filename });
      } catch (e) {
        stats.failed++;
        if (isRefresh) stats.keptOriginal++;
        stats.errors.push({ url, error: e.message });
        onProgress({ index: i, total: urls.length, url, decision, status: 'error', error: e.message });
      } finally {
        try { await page?.close(); } catch {}
      }

      if (i < urls.length - 1 && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  } finally {
    try { await context?.close(); } catch {}
    try { await browser.close(); } catch {}
  }

  return stats;
}
