import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { closeDB } from '$lib/db.js';
import { getConfig, normalizeDbEngine } from '$lib/config.js';

// Native optional packages such as DuckDB contain .node binaries. Keep these
// imports opaque to Vite/Rollup so production builds do not try to parse native
// binary files. Runtime resolution still happens from node_modules.
const runtimeImport = Function('specifier', 'return import(specifier)');
let currentAssetJob = null;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const PREVIEW_EXTENSIONS = ['.gif', '.webp'];

function quoteSql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}
function interpolate(sql, params = []) {
  let i = 0;
  return sql.replace(/\?/g, () => quoteSql(params[i++]));
}
function normalizeRows(rows) {
  return (rows || []).map((row) => {
    const out = { ...row };
    for (const [k, v] of Object.entries(out)) if (typeof v === 'bigint') out[k] = Number(v);
    return out;
  });
}

async function openWriteClient(dbPath, dbEngine) {
  if (normalizeDbEngine(dbEngine) === 'duckdb') {
    try {
      const mod = await runtimeImport('@duckdb/node-api');
      const instance = await mod.DuckDBInstance.create(dbPath);
      const connection = await instance.connect();
      return {
        engine: 'duckdb',
        async all(sql, params = []) { const r = await connection.runAndReadAll(interpolate(sql, params)); return normalizeRows(r.getRowObjectsJson()); },
        async run(sql, params = []) { await connection.run(interpolate(sql, params)); return { changes: 0 }; },
        async close() { try { await connection.close?.(); } catch {} try { await instance.close?.(); } catch {} },
      };
    } catch (newerError) {
      try {
        const mod = await runtimeImport('duckdb');
        const duckdb = mod.default || mod;
        const db = await new Promise((resolve, reject) => { const d = new duckdb.Database(dbPath, (err) => err ? reject(err) : resolve(d)); });
        const con = db.connect();
        return {
          engine: 'duckdb',
          all(sql, params = []) { return new Promise((resolve, reject) => con.all(interpolate(sql, params), (err, rows) => err ? reject(err) : resolve(normalizeRows(rows)))); },
          run(sql, params = []) { return new Promise((resolve, reject) => con.run(interpolate(sql, params), (err) => err ? reject(err) : resolve({ changes: 0 }))); },
          async close() { try { con.close?.(); } catch {} try { db.close?.(); } catch {} },
        };
      } catch (oldError) {
        throw new Error(`Could not open DuckDB for asset job. @duckdb/node-api: ${newerError.message}; duckdb: ${oldError.message}`);
      }
    }
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  return {
    engine: 'sqlite',
    all(sql, params = []) { return db.prepare(sql).all(...params); },
    run(sql, params = []) { return db.prepare(sql).run(...params); },
    close() { db.close(); },
  };
}

function createJob(type, config) {
  return {
    id: `${Date.now()}`,
    type,
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
    total: 0,
    processed: 0,
    generated: 0,
    skipped: 0,
    updated: 0,
    failed: 0,
    currentFile: '',
    currentProcess: null,
    startedAt: null,
    completedAt: null,
    messages: [],
  };
}

function pushMessage(job, text, level = 'info') {
  job.messages = [...job.messages.slice(-24), { at: new Date().toISOString(), level, text }];
}

function appBinCandidates() {
  const root = process.cwd();
  return process.platform === 'win32'
    ? [path.join(root, 'bin', 'ffmpeg.exe'), path.join(root, 'bin', 'ffmpeg')]
    : [path.join(root, 'bin', 'ffmpeg'), path.join(root, 'bin', 'ffmpeg.exe')];
}

function findFfmpegExecutable() {
  for (const candidate of appBinCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'ffmpeg';
}

class CancelledAssetJobError extends Error {
  constructor(message = 'Asset job cancelled.') {
    super(message);
    this.name = 'CancelledAssetJobError';
  }
}

function isCancelError(error) {
  return error?.name === 'CancelledAssetJobError';
}

function assertNotCancelled(job) {
  if (job?.cancelRequested) throw new CancelledAssetJobError();
}

function terminateChildProcess(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch {}
  if (process.platform === 'win32' && child.pid) {
    // ffmpeg on Windows can occasionally outlive SIGTERM; taskkill cleans up the process tree.
    setTimeout(() => {
      try {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } catch {}
    }, 1200).unref?.();
  }
}

function runProcess(command, args, cwd, job = null) {
  return new Promise((resolve, reject) => {
    try { assertNotCancelled(job); } catch (e) { reject(e); return; }
    const child = spawn(command, args, { cwd, windowsHide: true });
    if (job) job.currentProcess = child;
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      if (job?.currentProcess === child) job.currentProcess = null;
      reject(job?.cancelRequested ? new CancelledAssetJobError() : err);
    });
    child.on('close', (code) => {
      if (job?.currentProcess === child) job.currentProcess = null;
      if (job?.cancelRequested) reject(new CancelledAssetJobError());
      else if (code === 0) resolve({ code, stderr });
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function assertFfmpeg(ffmpegPath) {
  try {
    await runProcess(ffmpegPath, ['-version'], process.cwd());
  } catch (e) {
    throw new Error(`ffmpeg was not found or could not run. Install ffmpeg in PATH, or put ffmpeg${process.platform === 'win32' ? '.exe' : ''} in this application's bin folder. Details: ${e.message}`);
  }
}

function existingThumbnail(videoAbsPath) {
  const dir = path.dirname(videoAbsPath);
  const base = path.basename(videoAbsPath, path.extname(videoAbsPath));
  const candidates = [];
  for (const ext of IMAGE_EXTENSIONS) {
    candidates.push(path.join(dir, `${base}${ext}`));
    candidates.push(path.join(dir, `${base}.thumb${ext}`));
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function existingPreview(videoAbsPath) {
  const dir = path.dirname(videoAbsPath);
  const base = path.basename(videoAbsPath, path.extname(videoAbsPath));
  const candidates = [];
  for (const ext of PREVIEW_EXTENSIONS) {
    candidates.push(path.join(dir, `${base}${ext}`));
    candidates.push(path.join(dir, `${base}.gif${ext}`));
    candidates.push(path.join(dir, `${base}.preview${ext}`));
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function generatedPath(videoAbsPath, type) {
  const dir = path.dirname(videoAbsPath);
  const base = path.basename(videoAbsPath, path.extname(videoAbsPath));
  return type === 'thumbnail'
    ? path.join(dir, `${base}.jpg`)
    : path.join(dir, `${base}.preview.webp`);
}

async function getCandidateVideos(db, type) {
  if (type === 'thumbnail') {
    return db.all("SELECT id, file_path, thumbnail_path FROM videos WHERE thumbnail_path IS NULL OR thumbnail_path = '' ORDER BY id");
  }
  return db.all("SELECT id, file_path, preview_path FROM videos WHERE preview_path IS NULL OR preview_path = '' ORDER BY id");
}

async function setAssetPath(db, type, id, relPath) {
  const col = type === 'thumbnail' ? 'thumbnail_path' : 'preview_path';
  await db.run(`UPDATE videos SET ${col} = ? WHERE id = ?`, [relPath, id]);
}

async function generateThumbnail(ffmpeg, input, output, job) {
  // First frame, no overwrite. If the first frame is black, users can regenerate manually later.
  const tmp = `${output}.tmp.jpg`;
  fs.rmSync(tmp, { force: true });
  try {
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', '-i', input, '-frames:v', '1', '-q:v', '3', tmp], path.dirname(input), job);
    assertNotCancelled(job);
    if (!fs.existsSync(output)) fs.renameSync(tmp, output);
    else fs.rmSync(tmp, { force: true });
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

async function generatePreview(ffmpeg, input, output, job) {
  // 2.5 second animated WebP from very near the start. The tiny seek avoids all-black first frames in some exports.
  const tmp = `${output}.tmp.webp`;
  fs.rmSync(tmp, { force: true });
  try {
    await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', '-ss', '0.25', '-t', '2.5', '-i', input, '-vf', 'fps=12,scale=360:-1:flags=lanczos', '-loop', '0', '-an', tmp], path.dirname(input), job);
    assertNotCancelled(job);
    if (!fs.existsSync(output)) fs.renameSync(tmp, output);
    else fs.rmSync(tmp, { force: true });
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

async function runAssetJob(job) {
  const ffmpeg = findFfmpegExecutable();
  assertNotCancelled(job);
  job.phase = 'checking_ffmpeg';
  await assertFfmpeg(ffmpeg);
  assertNotCancelled(job);
  pushMessage(job, `Using ffmpeg: ${ffmpeg}`);

  await closeDB();
  const db = await openWriteClient(job.dbPath, job.dbEngine);
  try {
    job.phase = 'loading_candidates';
    const videos = await getCandidateVideos(db, job.type);
    assertNotCancelled(job);
    job.total = videos.length;
    if (job.total === 0) {
      job.phase = 'complete';
      pushMessage(job, `No missing ${job.type === 'thumbnail' ? 'thumbnails' : 'previews'} found.`);
      return;
    }

    job.phase = 'generating';
    for (const video of videos) {
      assertNotCancelled(job);
      job.processed++;
      job.currentFile = video.file_path;
      const videoAbs = path.resolve(job.archivePath, video.file_path);
      if (!fs.existsSync(videoAbs)) {
        job.failed++;
        pushMessage(job, `Missing video file: ${video.file_path}`, 'warn');
        continue;
      }

      const existing = job.type === 'thumbnail' ? existingThumbnail(videoAbs) : existingPreview(videoAbs);
      if (existing) {
        await setAssetPath(db, job.type, video.id, path.relative(job.archivePath, existing));
        job.skipped++;
        job.updated++;
        continue;
      }

      const out = generatedPath(videoAbs, job.type);
      if (fs.existsSync(out)) {
        await setAssetPath(db, job.type, video.id, path.relative(job.archivePath, out));
        job.skipped++;
        job.updated++;
        continue;
      }

      try {
        assertNotCancelled(job);
        if (job.type === 'thumbnail') await generateThumbnail(ffmpeg, videoAbs, out, job);
        else await generatePreview(ffmpeg, videoAbs, out, job);
        assertNotCancelled(job);
        await setAssetPath(db, job.type, video.id, path.relative(job.archivePath, out));
        job.generated++;
        job.updated++;
      } catch (e) {
        if (isCancelError(e)) throw e;
        // ffmpeg -n returns failure if file appears between the existence check and run; treat that as non-fatal if output exists now.
        if (fs.existsSync(out)) {
          await setAssetPath(db, job.type, video.id, path.relative(job.archivePath, out));
          job.skipped++;
          job.updated++;
        } else {
          job.failed++;
          pushMessage(job, `${video.file_path}: ${e.message}`, 'warn');
        }
      }
    }
    job.phase = 'complete';
  } finally {
    await db.close?.();
    await closeDB();
  }
}

function serializeJob(job) {
  if (!job) {
    return {
      running: false,
      done: false,
      ok: false,
      cancelled: false,
      cancelRequested: false,
      phase: 'idle',
      total: 0,
      processed: 0,
      generated: 0,
      skipped: 0,
      updated: 0,
      failed: 0,
      currentFile: '',
      messages: [],
    };
  }
  const { currentProcess, ...safe } = job;
  return safe;
}

export function getAssetJob() {
  return serializeJob(currentAssetJob);
}

export function startAssetJob(type) {
  if (!['thumbnail', 'preview'].includes(type)) throw new Error(`Unknown asset job type: ${type}`);
  if (currentAssetJob?.running) return currentAssetJob;
  const config = getConfig();
  if (!config) throw new Error('Setup is not complete.');
  currentAssetJob = createJob(type, config);
  currentAssetJob.running = true;
  currentAssetJob.startedAt = new Date().toISOString();
  currentAssetJob.phase = 'starting';

  runAssetJob(currentAssetJob)
    .then(() => {
      currentAssetJob.running = false;
      currentAssetJob.done = true;
      currentAssetJob.ok = true;
      currentAssetJob.completedAt = new Date().toISOString();
      if (currentAssetJob.cancelRequested) {
        currentAssetJob.ok = false;
        currentAssetJob.cancelled = true;
        currentAssetJob.phase = 'cancelled';
        pushMessage(currentAssetJob, 'Asset job cancelled by user.', 'warn');
      } else if (currentAssetJob.phase !== 'complete') currentAssetJob.phase = 'complete';
    })
    .catch(async (e) => {
      currentAssetJob.running = false;
      currentAssetJob.done = true;
      currentAssetJob.ok = false;
      currentAssetJob.completedAt = new Date().toISOString();
      if (isCancelError(e) || currentAssetJob.cancelRequested) {
        currentAssetJob.cancelled = true;
        currentAssetJob.error = null;
        currentAssetJob.phase = 'cancelled';
        pushMessage(currentAssetJob, 'Asset job cancelled by user.', 'warn');
      } else {
        currentAssetJob.error = e.message;
        currentAssetJob.phase = 'failed';
        pushMessage(currentAssetJob, e.message, 'error');
      }
      await closeDB().catch(() => {});
    });

  return currentAssetJob;
}


export function cancelAssetJob() {
  if (!currentAssetJob?.running) return getAssetJob();
  currentAssetJob.cancelRequested = true;
  currentAssetJob.phase = currentAssetJob.phase === 'generating' ? 'cancelling' : currentAssetJob.phase;
  pushMessage(currentAssetJob, 'Cancellation requested. The current ffmpeg process will stop, and partial output will be removed.', 'warn');
  terminateChildProcess(currentAssetJob.currentProcess);
  return getAssetJob();
}
