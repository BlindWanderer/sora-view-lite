import fs from 'fs';
import path from 'path';
import { readdir } from 'fs/promises';
import Database from 'better-sqlite3';
import { closeDB } from '$lib/db.js';
import { getConfig, normalizeDbEngine } from '$lib/config.js';
import { ensureAvatarsBatch, recordAvatarExt, reconcileAvatarRegistry } from '$lib/server/profile-fetch.js';

// Native optional packages such as DuckDB contain .node binaries. Keep these
// imports opaque to Vite/Rollup so production builds do not try to parse native
// binary files. Runtime resolution still happens from node_modules.
const runtimeImport = Function('specifier', 'return import(specifier)');

let currentAvatarJob = null;

function quoteSql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}
function interpolate(sql, params = []) { let i = 0; return sql.replace(/\?/g, () => quoteSql(params[i++])); }
function normalizeRows(rows) {
  return (rows || []).map((row) => {
    const out = { ...row };
    for (const [k, v] of Object.entries(out)) if (typeof v === 'bigint') out[k] = Number(v);
    return out;
  });
}

async function openWriteClient(dbPath, dbEngine) {
  if (normalizeDbEngine(dbEngine) === 'duckdb') {
    const mod = await runtimeImport('@duckdb/node-api');
    const instance = await mod.DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    return {
      engine: 'duckdb',
      async all(sql, params = []) { const r = await connection.runAndReadAll(interpolate(sql, params)); return normalizeRows(r.getRowObjectsJson()); },
      async get(sql, params = []) { const r = await connection.runAndReadAll(interpolate(sql, params)); return normalizeRows(r.getRowObjectsJson())[0] || null; },
      async run(sql, params = []) { await connection.run(interpolate(sql, params)); return { changes: 0 }; },
      async exec(sql) { await connection.run(sql); },
      async close() { try { await connection.close?.(); } catch {} try { await instance.close?.(); } catch {} },
    };
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  return {
    engine: 'sqlite',
    all(sql, params = []) { return db.prepare(sql).all(...params); },
    get(sql, params = []) { return db.prepare(sql).get(...params) || null; },
    run(sql, params = []) { return db.prepare(sql).run(...params); },
    exec(sql) { db.exec(sql); },
    close() { db.close(); },
  };
}

function createJob(config) {
  return {
    id: `${Date.now()}`,
    archivePath: config.archivePath,
    dbPath: config.dbPath,
    dbEngine: config.dbEngine,
    running: false,
    done: false,
    ok: false,
    cancelled: false,
    cancelRequested: false,
    error: null,
    phase: 'idle',
    filesScanned: 0,
    filesTotal: 0,
    profilesQueued: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    registered: 0,
    cleared: 0,
    currentFile: '',
    startedAt: null,
    completedAt: null,
    messages: [],
  };
}

function pushMessage(job, text, level = 'info') {
  if (!job) return;
  job.messages = [...job.messages.slice(-24), { at: new Date().toISOString(), level, text }];
}

async function* walkExtractedJson(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'profiles' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walkExtractedJson(full);
    } else if (entry.isFile() && /\.extracted\.json$/i.test(entry.name)) {
      yield full;
    }
  }
}

function profileFromAuthor(node) {
  if (!node?.username || !node?.profile_picture_url) return null;
  return { username: node.username, profile_picture_url: node.profile_picture_url };
}

async function collectProfiles(archivePath, job) {
  // Walk extracted.json files once and collect every (username, url) pair.
  // Dedup by username so the same person isn't tried twice in one run.
  const profiles = new Map();
  const files = [];
  for await (const f of walkExtractedJson(archivePath)) {
    if (job.cancelRequested) throw new Error('Cancelled.');
    files.push(f);
  }
  job.filesTotal = files.length;

  for (const file of files) {
    if (job.cancelRequested) throw new Error('Cancelled.');
    job.currentFile = path.relative(archivePath, file);
    job.filesScanned++;
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      const all = Array.isArray(payload?.all_profiles) ? payload.all_profiles : [];
      for (const p of all) {
        const profile = profileFromAuthor(p);
        if (profile && !profiles.has(profile.username)) profiles.set(profile.username, profile);
      }
      const posts = Array.isArray(payload?.posts) ? payload.posts : [];
      for (const post of posts) {
        const author = profileFromAuthor(post?.author);
        if (author && !profiles.has(author.username)) profiles.set(author.username, author);
        const cmts = Array.isArray(post?.comments) ? post.comments : [];
        for (const c of cmts) {
          const a = profileFromAuthor(c?.author);
          if (a && !profiles.has(a.username)) profiles.set(a.username, a);
        }
      }
    } catch (e) {
      pushMessage(job, `${file}: ${e.message}`, 'warn');
    }
  }
  job.profilesQueued = profiles.size;
  return Array.from(profiles.values());
}

async function runAvatarJob(job) {
  job.phase = 'scanning';
  const profiles = await collectProfiles(job.archivePath, job);
  if (job.cancelRequested) throw new Error('Cancelled.');

  const db = await openWriteClient(job.dbPath, job.dbEngine);
  try {
    job.phase = 'downloading';
    const result = await ensureAvatarsBatch(job.archivePath, profiles, {
      concurrency: 6,
      onError: ({ username, error, url, status }) => {
        const head = status ? `HTTP ${status}` : (error?.message || String(error));
        pushMessage(job, `${username}: ${head} — ${url || '(no url)'}`, 'warn');
      },
      onResult: async ({ username, status, filePath }) => {
        if (job.cancelRequested) return;
        if (status === 'downloaded') job.downloaded++;
        else if (status === 'skipped') job.skipped++;
        if ((status === 'downloaded' || status === 'skipped') && filePath) {
          const ext = path.extname(filePath).slice(1).toLowerCase();
          if (ext) await recordAvatarExt(db, username, ext);
        }
      },
    });
    job.failed = result.failed;

    if (job.cancelRequested) throw new Error('Cancelled.');
    job.phase = 'reconciling';
    const recon = await reconcileAvatarRegistry(db, job.archivePath);
    job.registered = recon.set + recon.unchanged;
    job.cleared = recon.cleared;
    job.phase = 'complete';
  } finally {
    await db.close?.();
  }
}

export function getAvatarJob() {
  return currentAvatarJob || {
    running: false,
    done: false,
    ok: false,
    phase: 'idle',
    filesScanned: 0,
    filesTotal: 0,
    profilesQueued: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    registered: 0,
    cleared: 0,
    currentFile: '',
    messages: [],
  };
}

export function startAvatarJob() {
  if (currentAvatarJob?.running) return currentAvatarJob;
  const config = getConfig();
  if (!config) throw new Error('Setup is not complete.');
  currentAvatarJob = createJob(config);
  currentAvatarJob.running = true;
  currentAvatarJob.startedAt = new Date().toISOString();
  currentAvatarJob.phase = 'starting';

  closeDB().catch(() => {});

  runAvatarJob(currentAvatarJob)
    .then(() => {
      currentAvatarJob.running = false;
      currentAvatarJob.done = true;
      currentAvatarJob.completedAt = new Date().toISOString();
      if (currentAvatarJob.cancelRequested) {
        currentAvatarJob.cancelled = true;
        currentAvatarJob.ok = false;
        currentAvatarJob.phase = 'cancelled';
        pushMessage(currentAvatarJob, 'Avatar job cancelled.', 'warn');
      } else {
        currentAvatarJob.ok = true;
        currentAvatarJob.phase = 'complete';
      }
    })
    .catch((e) => {
      currentAvatarJob.running = false;
      currentAvatarJob.done = true;
      currentAvatarJob.completedAt = new Date().toISOString();
      if (currentAvatarJob.cancelRequested || /cancel/i.test(e.message)) {
        currentAvatarJob.cancelled = true;
        currentAvatarJob.ok = false;
        currentAvatarJob.phase = 'cancelled';
        pushMessage(currentAvatarJob, 'Avatar job cancelled.', 'warn');
      } else {
        currentAvatarJob.ok = false;
        currentAvatarJob.error = e.message;
        currentAvatarJob.phase = 'failed';
        pushMessage(currentAvatarJob, e.message, 'error');
      }
    });

  return currentAvatarJob;
}

export function cancelAvatarJob() {
  if (!currentAvatarJob?.running) return getAvatarJob();
  currentAvatarJob.cancelRequested = true;
  pushMessage(currentAvatarJob, 'Cancellation requested. The current downloads will finish, then the job stops.', 'warn');
  return getAvatarJob();
}
