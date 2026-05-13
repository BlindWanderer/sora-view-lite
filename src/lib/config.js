import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export const CONFIG_PATH = path.resolve('config.json');

export const DB_ENGINES = new Set(['sqlite', 'duckdb']);
export const MANIFEST_MODES = new Set(['yes', 'no', 'unknown']);
export const ACCESS_MODES = new Set(['local', 'lan']);
export const MOBILE_FEED_LAYOUTS = new Set(['auto', 'grid', 'reel']);

let _cache = null;

export function dbExtension(engine = 'sqlite') {
  return engine === 'duckdb' ? 'duckdb' : 'db';
}

export function defaultDbPathForArchive(archivePath, engine = 'sqlite') {
  const resolved = path.resolve(archivePath || './sora');
  return path.join(resolved, engine === 'duckdb' ? 'sora.duckdb' : 'sora.db');
}

export function normalizeDbEngine(value) {
  return DB_ENGINES.has(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'sqlite';
}

export function normalizeManifestMode(value) {
  return MANIFEST_MODES.has(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'unknown';
}

export function normalizeAccessMode(value) {
  return ACCESS_MODES.has(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'local';
}

export function normalizeMobileFeedLayout(value) {
  return MOBILE_FEED_LAYOUTS.has(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'auto';
}

export function getConfig() {
  if (_cache) return _cache;

  if (!fs.existsSync(CONFIG_PATH)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const archivePath = path.resolve(parsed.archivePath || './sora');
    const dbEngine = normalizeDbEngine(parsed.dbEngine);
    const dbPath = path.resolve(parsed.dbPath || defaultDbPathForArchive(archivePath, dbEngine));

    _cache = {
      archivePath,
      dbPath,
      dbEngine,
      manifestMode: normalizeManifestMode(parsed.manifestMode),
      appPort: parsed.appPort || 5173,
      ownerUsername: parsed.ownerUsername || null,
      personInitialLimit: Number.isFinite(Number(parsed.personInitialLimit)) ? Math.max(25, Math.min(500, Number(parsed.personInitialLimit))) : 100,
      personLoadLimit: Number.isFinite(Number(parsed.personLoadLimit)) ? Math.max(50, Math.min(1000, Number(parsed.personLoadLimit))) : 250,
      personIndexInfo: ['minimal', 'profile', 'rich'].includes(String(parsed.personIndexInfo || '').toLowerCase()) ? String(parsed.personIndexInfo).toLowerCase() : 'minimal',
      personShowImages: parsed.personShowImages === true,
      serverAccessMode: normalizeAccessMode(parsed.serverAccessMode),
      showFullPaths: parsed.showFullPaths !== false,
      mobileFeedLayout: normalizeMobileFeedLayout(parsed.mobileFeedLayout),
    };

    return _cache;
  } catch (e) {
    console.error('Failed to parse config.json:', e.message);
    return null;
  }
}

export function saveConfig(data) {
  const archivePath = path.resolve(data.archivePath || './sora');
  const dbEngine = normalizeDbEngine(data.dbEngine);
  const dbPath = path.resolve(data.dbPath || defaultDbPathForArchive(archivePath, dbEngine));

  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({
      archivePath,
      dbPath,
      dbEngine,
      manifestMode: normalizeManifestMode(data.manifestMode),
      appPort: data.appPort || 5173,
      ownerUsername: data.ownerUsername || null,
      personInitialLimit: Number.isFinite(Number(data.personInitialLimit)) ? Math.max(25, Math.min(500, Number(data.personInitialLimit))) : 100,
      personLoadLimit: Number.isFinite(Number(data.personLoadLimit)) ? Math.max(50, Math.min(1000, Number(data.personLoadLimit))) : 250,
      personIndexInfo: ['minimal', 'profile', 'rich'].includes(String(data.personIndexInfo || '').toLowerCase()) ? String(data.personIndexInfo).toLowerCase() : 'minimal',
      personShowImages: data.personShowImages === true,
      serverAccessMode: normalizeAccessMode(data.serverAccessMode),
      showFullPaths: data.showFullPaths !== false,
      mobileFeedLayout: normalizeMobileFeedLayout(data.mobileFeedLayout),
    }, null, 2),
    'utf8'
  );

  _cache = null;
}

export function updateConfig(partial = {}) {
  const current = getConfig() || {};
  saveConfig({ ...current, ...partial });
}

export function configExists() {
  return fs.existsSync(CONFIG_PATH);
}

export function validateArchivePath(archivePath) {
  if (!archivePath || !archivePath.trim()) {
    return { ok: false, error: 'Archive path is required.' };
  }

  const resolved = path.resolve(archivePath.trim());

  if (!fs.existsSync(resolved)) {
    return { ok: false, error: `Archive folder does not exist: ${resolved}` };
  }

  if (!fs.statSync(resolved).isDirectory()) {
    return { ok: false, error: `Archive path is not a folder: ${resolved}` };
  }

  return { ok: true, path: resolved };
}

export function inspectDatabase(dbPath, dbEngine = 'sqlite') {
  if (!dbPath) return { exists: false, ready: false, error: 'No database path configured.' };
  if (!fs.existsSync(dbPath)) return { exists: false, ready: false };

  if (normalizeDbEngine(dbEngine) === 'duckdb') {
    // DuckDB readiness is validated by the query layer after opening. Keeping
    // this synchronous lets the setup redirect logic remain simple.
    return { exists: true, ready: true, totalVideos: null, engine: 'duckdb' };
  }

  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('videos', 'cameos')
    `).all().map((row) => row.name);

    if (!tables.includes('videos') || !tables.includes('cameos')) {
      return { exists: true, ready: false, error: 'Database exists, but the expected videos/cameos schema is missing.' };
    }

    const totalVideos = db.prepare('SELECT COUNT(*) AS n FROM videos').get().n;
    return { exists: true, ready: true, totalVideos, engine: 'sqlite' };
  } catch (e) {
    return { exists: true, ready: false, error: e.message };
  } finally {
    if (db) db.close();
  }
}

export function getAppState() {
  const config = getConfig();
  if (!config) return { state: 'needs_setup', ready: false, config: null };

  const archive = validateArchivePath(config.archivePath);
  if (!archive.ok) {
    return { state: 'missing_archive', ready: false, config, error: archive.error };
  }

  const db = inspectDatabase(config.dbPath, config.dbEngine);
  if (!db.ready) {
    return { state: 'needs_ingest', ready: false, config, database: db, error: db.error || null };
  }

  return { state: 'ready', ready: true, config, database: db };
}
