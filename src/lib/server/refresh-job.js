import fs from 'fs';
import path from 'path';
import { getConfig } from '$lib/config.js';
import { ensureRefreshDirs, refreshPaths } from '$lib/server/refresh/paths.js';
import { extractFromDir } from '$lib/server/refresh/extract-permalinks.js';
import { dedupeAndFilter } from '$lib/server/refresh/dedupe-filter.js';
import { fetchHtmlBatch } from '$lib/server/refresh/fetch-html.js';
import { extractHtmlBatch } from '$lib/server/refresh/extract-html.js';
import { downloadAssetsBatch, getAssetInventory } from '$lib/server/refresh/download-assets.js';
import { checkPlaywright } from '$lib/server/refresh/playwright-check.js';
import { readLastRun, writeLastRun } from '$lib/server/refresh/last-run.js';

/**
 * Job state for the refresh pipeline. Tracks each step independently so the UI
 * can show one panel per step. A single job instance per stage prevents two
 * downloads from running at once and lets the page poll status.
 *
 * Stages (all 5 wired):
 *   1. extract-permalinks  -- manifests/    -> links/<basename>.links.txt
 *   2. dedupe-filter       -- links/        -> links/clean-links.txt
 *   3. fetch-html          -- clean-links   -> html/<slug>.html (+ archive/)
 *   4. extract-html        -- html/         -> extracted/<slug>.extracted.json (+ archive/)
 *   5. download-assets     -- extracted/    -> profiles/, _refresh/assets/{thumbnails,gifs}/
 */

let currentRefreshJob = null;

function createJob(config, stage) {
  return {
    id: `${Date.now()}-${stage}`,
    stage,
    archivePath: config.archivePath,
    running: true,
    done: false,
    ok: false,
    cancelled: false,
    cancelRequested: false,
    error: null,
    phase: 'starting',
    startedAt: new Date().toISOString(),
    completedAt: null,
    messages: [],
    // stage-specific result payload populated as the job runs
    result: null,
  };
}

function pushMessage(job, text, level = 'info') {
  if (!job) return;
  job.messages = [...job.messages.slice(-24), { at: new Date().toISOString(), level, text }];
}

function finishJob(job, error) {
  job.running = false;
  job.done = true;
  job.completedAt = new Date().toISOString();
  if (error) {
    job.ok = false;
    job.error = error.message || String(error);
    job.phase = 'failed';
    pushMessage(job, job.error, 'error');
  } else if (job.cancelRequested) {
    job.cancelled = true;
    job.ok = false;
    job.phase = 'cancelled';
  } else {
    job.ok = true;
    job.phase = 'complete';
  }
}

export function getRefreshJob() {
  return currentRefreshJob || {
    running: false,
    done: false,
    ok: false,
    stage: null,
    phase: 'idle',
    messages: [],
    result: null,
  };
}

export function cancelRefreshJob() {
  if (!currentRefreshJob?.running) return getRefreshJob();
  currentRefreshJob.cancelRequested = true;
  pushMessage(currentRefreshJob, 'Cancellation requested.', 'warn');
  return getRefreshJob();
}

function ensureNotBusy() {
  if (currentRefreshJob?.running) {
    throw new Error(`Another refresh step is already running (${currentRefreshJob.stage}).`);
  }
}

/**
 * STEP 1: extract permalinks from every manifest in _refresh/manifests/
 * Output: _refresh/links/<basename>.links.txt per manifest.
 */
export function startExtractPermalinks() {
  ensureNotBusy();
  const config = getConfig();
  if (!config) throw new Error('Setup is not complete.');

  const paths = ensureRefreshDirs(config.archivePath);
  currentRefreshJob = createJob(config, 'extract-permalinks');
  const job = currentRefreshJob;

  setImmediate(() => {
    try {
      job.phase = 'scanning';
      pushMessage(job, `Scanning ${path.relative(config.archivePath, paths.manifests)} for manifests…`);
      const totals = extractFromDir(paths.manifests, paths.links, (r) => {
        const tag = r.isDraft ? ' [drafts]' : '';
        if (!r.ok) {
          pushMessage(job, `${r.basename}: ${r.error}`, 'error');
        } else if (r.links === 0 && r.isDraft) {
          pushMessage(job, `${r.basename}${tag}: no public permalinks (drafts)`, 'info');
        } else if (r.links === 0) {
          pushMessage(job, `${r.basename}: 0 links found`, 'warn');
        } else {
          pushMessage(job, `${r.basename}${tag}: ${r.links} links → ${path.basename(r.outputFile)}`);
        }
      });
      job.result = totals;
      finishJob(job);
    } catch (e) {
      finishJob(job, e);
    }
  });

  return job;
}

/**
 * STEP 2: dedupe and filter all *.links.txt across the links/ folder
 * down to /p/ post URLs. Mirrors `cat *.links.txt | dedupe | grep /p/`.
 * Output: _refresh/links/clean-links.txt
 */
export function startDedupeLinks() {
  ensureNotBusy();
  const config = getConfig();
  if (!config) throw new Error('Setup is not complete.');

  const paths = ensureRefreshDirs(config.archivePath);
  currentRefreshJob = createJob(config, 'dedupe-filter');
  const job = currentRefreshJob;

  setImmediate(() => {
    try {
      job.phase = 'reading';
      const outFile = path.join(paths.links, 'clean-links.txt');
      pushMessage(job, `Reading ${path.relative(config.archivePath, paths.links)}…`);
      const stats = dedupeAndFilter(paths.links, outFile);
      job.result = { ...stats, outputFile: outFile };

      for (const err of stats.errors) pushMessage(job, err, 'warn');
      pushMessage(
        job,
        `Kept ${stats.kept} unique post URLs (dropped ${stats.duplicates} duplicates, ${stats.nonPost} non-/p/, ${stats.blankOrComment} blank/comment).`
      );
      if (stats.kept > 0) {
        pushMessage(job, `Wrote ${path.relative(config.archivePath, outFile)}.`);
      } else {
        pushMessage(job, 'No post URLs found — drop manifests in _refresh/manifests/ and run step 1 first.', 'warn');
      }
      finishJob(job);
    } catch (e) {
      finishJob(job, e);
    }
  });

  return job;
}

/**
 * STEP 3: fetch fresh HTML for every URL in clean-links.txt using Playwright
 * with JS disabled. Files newer than 7 days are skipped; older files are
 * re-fetched and the old version is moved to _refresh/archive/<date>/ on
 * success. On failure (HTTP 4xx, sunset page, no RSC payload) the original
 * file is kept untouched.
 */
export function startFetchHtml() {
  ensureNotBusy();
  const config = getConfig();
  if (!config) throw new Error('Setup is not complete.');

  const paths = ensureRefreshDirs(config.archivePath);
  currentRefreshJob = createJob(config, 'fetch-html');
  const job = currentRefreshJob;
  job.progress = { index: 0, total: 0 };

  setImmediate(async () => {
    try {
      // Refuse early with a clear message if Playwright isn't ready, so the
      // user sees the install card on the panel rather than a launch error.
      job.phase = 'checking-playwright';
      const pw = await checkPlaywright({ probeBrowser: true });
      if (!pw.ok) {
        const hint = pw.reason === 'missing-package'
          ? 'Run `npm install playwright` and then `npx playwright install chromium`.'
          : pw.reason === 'missing-browser'
          ? 'Run `npx playwright install chromium`.'
          : (pw.error || 'Playwright is not usable on this machine.');
        throw new Error(`Playwright not ready: ${hint}`);
      }

      const linksFile = path.join(paths.links, 'clean-links.txt');
      if (!fs.existsSync(linksFile)) {
        throw new Error('clean-links.txt does not exist — run steps 1 and 2 first.');
      }

      job.phase = 'fetching';
      pushMessage(job, `Fetching from ${path.relative(config.archivePath, linksFile)}…`);

      const stats = await fetchHtmlBatch({
        linksFile,
        htmlDir: paths.html,
        archiveDir: paths.archive,
        callbacks: {
          shouldCancel: () => job.cancelRequested,
          onProgress: (state) => {
            job.progress = { index: state.index + 1, total: state.total };
            job.currentFile = state.url;
            const slug = state.filename || (state.url || '').split('/').pop();
            if (state.status === 'ok' && state.decision === 'fetch-new') {
              pushMessage(job, `[new]      ${slug}  (${(state.size/1024).toFixed(0)} KB)`);
            } else if (state.status === 'ok' && state.decision === 'fetch-refresh') {
              pushMessage(job, `[refresh]  ${slug}  (${(state.size/1024).toFixed(0)} KB)`);
            } else if (state.status === 'skipped') {
              // Skipped files are common — only log occasionally to avoid noise.
              if ((state.index + 1) % 25 === 0) {
                pushMessage(job, `[skipped fresh] ${state.index + 1}/${state.total} so far`);
              }
            } else if (state.status === 'failed') {
              const tag = state.sunset ? 'sunset' : (state.httpStatus ? `HTTP ${state.httpStatus}` : 'no RSC');
              pushMessage(job, `[fail ${tag}] ${slug}${state.decision === 'fetch-refresh' ? ' (kept original)' : ''}`, 'warn');
            } else if (state.status === 'error') {
              pushMessage(job, `[error] ${slug}: ${state.error}`, 'error');
            }
          },
        },
      });

      job.result = stats;
      pushMessage(
        job,
        `Done. new=${stats.fetchedNew}, refreshed=${stats.refreshed}, ` +
        `skipped-fresh=${stats.skippedFresh}, failed=${stats.failed} ` +
        `(of which ${stats.sunset} sunset, ${stats.keptOriginal} originals kept), ` +
        `archived=${stats.archived}.`
      );
      finishJob(job);
    } catch (e) {
      finishJob(job, e);
    }
  });

  return job;
}

/**
 * STEP 4: extract metadata from every saved HTML file. Walks _refresh/html/
 * and produces a matching <slug>.extracted.json in _refresh/extracted/. Same
 * age policy as fetch-html: extracted.json files <7 days old are skipped;
 * older files are re-extracted with archive-on-success-only.
 */
export function startExtractHtml() {
  ensureNotBusy();
  const config = getConfig();
  if (!config) throw new Error('Setup is not complete.');

  const paths = ensureRefreshDirs(config.archivePath);
  currentRefreshJob = createJob(config, 'extract-html');
  const job = currentRefreshJob;
  job.progress = { index: 0, total: 0 };

  setImmediate(() => {
    try {
      job.phase = 'extracting';
      pushMessage(job, `Extracting from ${path.relative(config.archivePath, paths.html)}…`);

      const stats = extractHtmlBatch({
        htmlDir: paths.html,
        outputDir: paths.extracted,
        archiveDir: paths.archive,
        callbacks: {
          shouldCancel: () => job.cancelRequested,
          onProgress: (state) => {
            job.progress = { index: state.index + 1, total: state.total };
            const slug = path.basename(state.file, '.html');
            job.currentFile = slug;
            if (state.status === 'ok' && state.decision === 'extract-new') {
              pushMessage(job, `[new]      ${slug}  (${state.posts}p / ${state.videos}v / ${state.comments}c)`);
            } else if (state.status === 'ok' && state.decision === 'extract-refresh') {
              pushMessage(job, `[refresh]  ${slug}  (${state.posts}p / ${state.videos}v / ${state.comments}c)`);
            } else if (state.status === 'skipped') {
              if ((state.index + 1) % 25 === 0) {
                pushMessage(job, `[skipped fresh] ${state.index + 1}/${state.total} so far`);
              }
            } else if (state.status === 'failed') {
              const kept = state.decision === 'extract-refresh' ? ' (kept original)' : '';
              pushMessage(job, `[fail] ${slug}: ${state.error}${kept}`, 'warn');
            }
          },
        },
      });

      job.result = stats;
      pushMessage(
        job,
        `Done. new=${stats.extractedNew}, refreshed=${stats.refreshed}, ` +
        `skipped-fresh=${stats.skippedFresh}, failed=${stats.failed} ` +
        `(${stats.keptOriginal} originals kept), archived=${stats.archived}.  ` +
        `Total ${stats.totalPosts} posts / ${stats.totalVideos} videos / ${stats.totalComments} comments.`
      );
      finishJob(job);
    } catch (e) {
      finishJob(job, e);
    }
  });

  return job;
}

/**
 * STEP 5: download official Sora assets (avatars, thumbnails, GIF previews)
 * using the URLs in extracted.json files. The user picks which types to
 * fetch via checkboxes — all default to on. Skip-if-exists; binaries are
 * "final" once on disk, so the 7-day age policy does NOT apply here.
 *
 * `types` shape: { avatars: bool, thumbnails: bool, gifs: bool }.
 * If every flag is false the job fails fast with a clear message.
 */
export function startAssetDownload(types) {
  ensureNotBusy();
  const config = getConfig();
  if (!config) throw new Error('Setup is not complete.');

  const want = {
    avatars:    types?.avatars    !== false && types?.avatars    !== 'false' && !!types?.avatars,
    thumbnails: types?.thumbnails !== false && types?.thumbnails !== 'false' && !!types?.thumbnails,
    gifs:       types?.gifs       !== false && types?.gifs       !== 'false' && !!types?.gifs,
  };
  if (!want.avatars && !want.thumbnails && !want.gifs) {
    throw new Error('Pick at least one asset type to download.');
  }

  ensureRefreshDirs(config.archivePath);
  currentRefreshJob = createJob(config, 'download-assets');
  const job = currentRefreshJob;
  job.types = want;
  job.progress = { phase: 'starting', kind: null, index: 0, total: 0 };
  job.queued = { avatars: 0, thumbnails: 0, gifs: 0 };

  setImmediate(async () => {
    try {
      job.phase = 'collecting';
      pushMessage(job, 'Walking *.extracted.json to collect URLs…');

      const result = await downloadAssetsBatch({
        archivePath: config.archivePath,
        types: want,
        callbacks: {
          shouldCancel: () => job.cancelRequested,
          onProgress: (state) => {
            if (state.phase === 'queued') {
              job.queued = state.queued;
              const parts = [];
              if (want.avatars)    parts.push(`${state.queued.avatars} avatars`);
              if (want.thumbnails) parts.push(`${state.queued.thumbnails} thumbnails`);
              if (want.gifs)       parts.push(`${state.queued.gifs} GIFs`);
              pushMessage(job, `Queued: ${parts.join(', ') || 'nothing'}`);
            } else if (state.phase === 'downloading') {
              job.phase = `downloading-${state.kind}`;
              job.progress = { phase: 'downloading', kind: state.kind, index: 0, total: state.total };
              pushMessage(job, `Downloading ${state.total} ${state.kind}…`);
            }
          },
          onResult: (state) => {
            if (state.kind && job.progress?.kind === state.kind) {
              job.progress.index = (state.index ?? job.progress.index) + 1;
            }
            // Verbose per-result logging would flood the panel; rely on the
            // per-type summary at the end and the failure log below.
          },
          onError: ({ kind, username, url, error, status }) => {
            const head = status ? `HTTP ${status}` : (error?.message || String(error));
            const who = username ? `@${username}` : (url || '(no url)');
            pushMessage(job, `[fail ${kind}] ${who}: ${head}`, 'warn');
          },
        },
      });

      job.result = result;
      const lines = [];
      if (want.avatars)    lines.push(`avatars: ${result.avatars.downloaded} downloaded, ${result.avatars.skipped} on disk, ${result.avatars.failed} failed`);
      if (want.thumbnails) lines.push(`thumbnails: ${result.thumbnails.downloaded} downloaded, ${result.thumbnails.skipped} on disk, ${result.thumbnails.failed} failed`);
      if (want.gifs)       lines.push(`gifs: ${result.gifs.downloaded} downloaded, ${result.gifs.skipped} on disk, ${result.gifs.failed} failed`);
      for (const l of lines) pushMessage(job, l);
      finishJob(job);
    } catch (e) {
      finishJob(job, e);
    }
  });

  return job;
}

/**
 * RUN ALL: orchestrate steps 1-5 sequentially in a single job. Each stage's
 * worker is invoked directly (bypassing the start* wrappers and their busy
 * lock) so the run-all itself is the single in-flight job.
 *
 * Soft skips:
 *   - 0 manifests in _refresh/manifests/  -> skip steps 1-2 entirely
 *   - 0 link files                        -> skip step 2
 *   - clean-links.txt missing             -> abort with a clear error
 *   - 0 html files                        -> skip step 4
 *   - 0 extracted.json files at the end   -> step 5 will simply find nothing
 *
 * Hard failures (aborts the rest):
 *   - Playwright not ready before step 3
 *   - Cancel requested
 */
export function startRunAll(types) {
  ensureNotBusy();
  const config = getConfig();
  if (!config) throw new Error('Setup is not complete.');

  const want = {
    avatars:    !!types?.avatars,
    thumbnails: !!types?.thumbnails,
    gifs:       !!types?.gifs,
  };

  const paths = ensureRefreshDirs(config.archivePath);
  currentRefreshJob = createJob(config, 'run-all');
  const job = currentRefreshJob;
  job.types = want;
  job.progress = { phase: 'starting', kind: null, index: 0, total: 0 };
  job.steps = {
    'extract-permalinks': { ran: false, ok: null, skipped: false, result: null },
    'dedupe-filter':      { ran: false, ok: null, skipped: false, result: null },
    'fetch-html':         { ran: false, ok: null, skipped: false, result: null },
    'extract-html':       { ran: false, ok: null, skipped: false, result: null },
    'download-assets':    { ran: false, ok: null, skipped: false, result: null },
  };

  const startedAt = Date.now();

  setImmediate(async () => {
    try {
      // ---- Step 1: extract permalinks ----
      job.phase = 'extract-permalinks';
      const manifestList = fs.existsSync(paths.manifests)
        ? fs.readdirSync(paths.manifests).filter((f) => f.toLowerCase().endsWith('.json'))
        : [];
      if (manifestList.length === 0) {
        job.steps['extract-permalinks'].ran = false;
        job.steps['extract-permalinks'].skipped = true;
        pushMessage(job, '[1] No manifests in _refresh/manifests/, skipping.');
      } else {
        pushMessage(job, `[1] Extracting permalinks from ${manifestList.length} manifest(s)…`);
        const r = extractFromDir(paths.manifests, paths.links, (p) => {
          if (p.ok && p.links > 0) pushMessage(job, `    ${p.basename}: ${p.links} links`);
          else if (!p.ok) pushMessage(job, `    ${p.basename}: ${p.error}`, 'warn');
        });
        job.steps['extract-permalinks'] = { ran: true, ok: true, skipped: false, result: r };
        pushMessage(job, `[1] Done — ${r.totalLinks} links across ${r.okFiles} manifest(s).`);
      }
      if (job.cancelRequested) throw new Error('Cancelled.');

      // ---- Step 2: dedupe + filter ----
      job.phase = 'dedupe-filter';
      const linkFileCount = fs.existsSync(paths.links)
        ? fs.readdirSync(paths.links).filter((f) => f.toLowerCase().endsWith('.links.txt')).length
        : 0;
      if (linkFileCount === 0) {
        job.steps['dedupe-filter'].skipped = true;
        pushMessage(job, '[2] No link files yet, skipping.');
      } else {
        pushMessage(job, `[2] Deduping + filtering ${linkFileCount} link file(s)…`);
        const cleanFile = path.join(paths.links, 'clean-links.txt');
        const r = dedupeAndFilter(paths.links, cleanFile);
        job.steps['dedupe-filter'] = { ran: true, ok: true, skipped: false, result: { ...r, outputFile: cleanFile } };
        pushMessage(job, `[2] Done — ${r.kept} unique post URLs.`);
      }
      if (job.cancelRequested) throw new Error('Cancelled.');

      // ---- Step 3: fetch HTML ----
      job.phase = 'fetch-html';
      const cleanFile = path.join(paths.links, 'clean-links.txt');
      if (!fs.existsSync(cleanFile)) {
        // Hard failure — without URLs there's nothing for steps 3-4 to do.
        // Step 5 may still find work in pre-existing extracted.json files.
        job.steps['fetch-html'].skipped = true;
        job.steps['extract-html'].skipped = true;
        pushMessage(job, '[3] No clean-links.txt — skipping fetch + extract. Run step 1 first if you have manifests.', 'warn');
      } else {
        pushMessage(job, '[3] Checking Playwright…');
        const pw = await checkPlaywright({ probeBrowser: true });
        if (!pw.ok) {
          const hint = pw.reason === 'missing-package'
            ? 'npm install playwright && npx playwright install chromium'
            : pw.reason === 'missing-browser'
            ? 'npx playwright install chromium'
            : (pw.error || 'unknown');
          throw new Error(`Playwright not ready (${pw.reason}): ${hint}`);
        }
        pushMessage(job, '[3] Fetching HTML…');
        const r3 = await fetchHtmlBatch({
          linksFile: cleanFile,
          htmlDir: paths.html,
          archiveDir: paths.archive,
          callbacks: {
            shouldCancel: () => job.cancelRequested,
            onProgress: (state) => {
              job.progress = { phase: 'fetching', kind: 'html', index: state.index + 1, total: state.total };
              if (state.status === 'failed' && state.decision === 'fetch-refresh') {
                // Logged at warn level so retried-and-failed entries surface.
                pushMessage(job, `    [3] failed (kept original): ${state.url}`, 'warn');
              }
            },
          },
        });
        job.steps['fetch-html'] = { ran: true, ok: true, skipped: false, result: r3 };
        pushMessage(job, `[3] Done — new=${r3.fetchedNew}, refreshed=${r3.refreshed}, skipped=${r3.skippedFresh}, failed=${r3.failed}.`);
      }
      if (job.cancelRequested) throw new Error('Cancelled.');

      // ---- Step 4: extract HTML -> JSON ----
      if (!job.steps['extract-html'].skipped) {
        job.phase = 'extract-html';
        const htmlCount = fs.existsSync(paths.html)
          ? fs.readdirSync(paths.html).filter((f) => f.toLowerCase().endsWith('.html')).length
          : 0;
        if (htmlCount === 0) {
          job.steps['extract-html'].skipped = true;
          pushMessage(job, '[4] No HTML files in _refresh/html/, skipping.');
        } else {
          pushMessage(job, `[4] Extracting metadata from ${htmlCount} HTML file(s)…`);
          const r4 = extractHtmlBatch({
            htmlDir: paths.html,
            outputDir: paths.extracted,
            archiveDir: paths.archive,
            callbacks: {
              shouldCancel: () => job.cancelRequested,
              onProgress: (state) => {
                job.progress = { phase: 'extracting', kind: 'extracted.json', index: state.index + 1, total: state.total };
              },
            },
          });
          job.steps['extract-html'] = { ran: true, ok: true, skipped: false, result: r4 };
          pushMessage(job, `[4] Done — new=${r4.extractedNew}, refreshed=${r4.refreshed}, posts=${r4.totalPosts}, comments=${r4.totalComments}.`);
        }
        if (job.cancelRequested) throw new Error('Cancelled.');
      }

      // ---- Step 5: download assets ----
      if (!want.avatars && !want.thumbnails && !want.gifs) {
        job.steps['download-assets'].skipped = true;
        pushMessage(job, '[5] No asset types selected, skipping.');
      } else {
        job.phase = 'download-assets';
        pushMessage(job, '[5] Collecting URLs and downloading selected assets…');
        const r5 = await downloadAssetsBatch({
          archivePath: config.archivePath,
          types: want,
          callbacks: {
            shouldCancel: () => job.cancelRequested,
            onProgress: (state) => {
              if (state.phase === 'queued') {
                const parts = [];
                if (want.avatars)    parts.push(`${state.queued.avatars} avatars`);
                if (want.thumbnails) parts.push(`${state.queued.thumbnails} thumbnails`);
                if (want.gifs)       parts.push(`${state.queued.gifs} GIFs`);
                pushMessage(job, `    Queued: ${parts.join(', ') || 'nothing'}`);
              } else if (state.phase === 'downloading') {
                job.progress = { phase: 'downloading', kind: state.kind, index: 0, total: state.total };
                pushMessage(job, `    Downloading ${state.total} ${state.kind}…`);
              }
            },
            onResult: (state) => {
              if (state.kind && job.progress?.kind === state.kind) {
                job.progress.index = (state.index ?? job.progress.index) + 1;
              }
            },
            onError: ({ kind, username, url, error, status }) => {
              const head = status ? `HTTP ${status}` : (error?.message || String(error));
              const who = username ? `@${username}` : (url || '(no url)');
              pushMessage(job, `    [5 fail ${kind}] ${who}: ${head}`, 'warn');
            },
          },
        });
        job.steps['download-assets'] = { ran: true, ok: true, skipped: false, result: r5 };
        const lines = [];
        if (want.avatars)    lines.push(`avatars: ${r5.avatars.downloaded}↓ ${r5.avatars.skipped}=  ${r5.avatars.failed}✗`);
        if (want.thumbnails) lines.push(`thumbs: ${r5.thumbnails.downloaded}↓ ${r5.thumbnails.skipped}=  ${r5.thumbnails.failed}✗`);
        if (want.gifs)       lines.push(`gifs: ${r5.gifs.downloaded}↓ ${r5.gifs.skipped}=  ${r5.gifs.failed}✗`);
        pushMessage(job, `[5] Done — ${lines.join(' | ')}`);
      }

      // ---- Persist a "last successful run" snapshot ----
      const durationMs = Date.now() - startedAt;
      const summary = {
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        types: want,
        steps: {
          'extract-permalinks': summarizeStep(job.steps['extract-permalinks']),
          'dedupe-filter':      summarizeStep(job.steps['dedupe-filter']),
          'fetch-html':         summarizeStep(job.steps['fetch-html']),
          'extract-html':       summarizeStep(job.steps['extract-html']),
          'download-assets':    summarizeStep(job.steps['download-assets']),
        },
      };
      try { writeLastRun(config.archivePath, summary); }
      catch (e) { pushMessage(job, `Could not persist last-run summary: ${e.message}`, 'warn'); }
      job.result = summary;

      finishJob(job);
    } catch (e) {
      finishJob(job, e);
    }
  });

  return job;
}

/**
 * Reduce the step state to the summary fields the UI cares about. Keeps the
 * persisted last-run.json small and stable across changes to the per-step
 * result shapes.
 */
function summarizeStep(stepState) {
  if (!stepState?.ran) return { ran: false, skipped: !!stepState?.skipped };
  const r = stepState.result || {};
  // Pull a handful of common fields; missing ones are fine.
  return {
    ran: true,
    skipped: false,
    ok: stepState.ok !== false,
    // Step 1
    files: r.files,
    okFiles: r.okFiles,
    totalLinks: r.totalLinks,
    // Step 2
    sourceFiles: r.sourceFiles,
    kept: r.kept,
    // Step 3
    fetchedNew: r.fetchedNew,
    refreshed: r.refreshed,
    skippedFresh: r.skippedFresh,
    failed: r.failed,
    archived: r.archived,
    // Step 4
    extractedNew: r.extractedNew,
    totalPosts: r.totalPosts,
    totalVideos: r.totalVideos,
    totalComments: r.totalComments,
    // Step 5
    avatars:    r.avatars    && { downloaded: r.avatars.downloaded,    skipped: r.avatars.skipped,    failed: r.avatars.failed,    total: r.avatars.total },
    thumbnails: r.thumbnails && { downloaded: r.thumbnails.downloaded, skipped: r.thumbnails.skipped, failed: r.thumbnails.failed, total: r.thumbnails.total },
    gifs:       r.gifs       && { downloaded: r.gifs.downloaded,       skipped: r.gifs.skipped,       failed: r.gifs.failed,       total: r.gifs.total },
  };
}

/**
 * Read-through accessor for the panel. Cached internally for 30s.
 */
export async function getPlaywrightStatus({ probeBrowser = true } = {}) {
  return checkPlaywright({ probeBrowser });
}

/**
 * Read the persisted "last full refresh" record so the panel can surface a
 * one-line summary at the top of the assets tab. Returns null when no run
 * has been completed yet.
 */
export function getLastRefreshRun() {
  const config = getConfig();
  if (!config) return null;
  return readLastRun(config.archivePath);
}

/**
 * Lightweight read-only inspector for the panel: how many manifests are
 * waiting, how many link files exist, does clean-links.txt exist + line count,
 * how many HTML files are already cached (and how many are >7 days old).
 */
export function getRefreshInventory() {
  const config = getConfig();
  if (!config) return null;
  const paths = refreshPaths(config.archivePath);

  const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
  const listJson = (dir) => {
    if (!exists(dir)) return [];
    try { return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')); }
    catch { return []; }
  };
  const listLinks = (dir) => {
    if (!exists(dir)) return [];
    try { return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.links.txt')); }
    catch { return []; }
  };
  const lineCount = (file) => {
    try {
      return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length;
    } catch { return 0; }
  };
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const ageInfo = (dir, suffix) => {
    if (!exists(dir)) return { count: 0, stale: 0 };
    let count = 0, stale = 0;
    try {
      const now = Date.now();
      for (const name of fs.readdirSync(dir)) {
        if (!name.toLowerCase().endsWith(suffix)) continue;
        count++;
        try {
          const stat = fs.statSync(path.join(dir, name));
          if ((now - stat.mtimeMs) >= SEVEN_DAYS) stale++;
        } catch {}
      }
    } catch {}
    return { count, stale };
  };

  const cleanFile = path.join(paths.links, 'clean-links.txt');
  return {
    paths,
    manifestCount: listJson(paths.manifests).length,
    linkFileCount: listLinks(paths.links).length,
    cleanLinks: {
      exists: exists(cleanFile),
      lines: exists(cleanFile) ? lineCount(cleanFile) : 0,
      path: cleanFile,
    },
    html: ageInfo(paths.html, '.html'),
    extracted: ageInfo(paths.extracted, '.extracted.json'),
    assets: getAssetInventory(config.archivePath),
  };
}
