import Database from 'better-sqlite3';
import { getConfig, normalizeDbEngine } from './config.js';

// Native optional packages such as DuckDB contain .node binaries. Keep these
// imports opaque to Vite/Rollup so production builds do not try to parse native
// binary files. Runtime resolution still happens from node_modules.
const runtimeImport = Function('specifier', 'return import(specifier)');
let _client = null;
let _clientKey = null;
let _clientPromise = null;
let _clientPromiseKey = null;

export const PAGE_SIZE = 24;

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
    if (!row || typeof row !== 'object') return row;
    const out = { ...row };
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === 'bigint') out[k] = Number(v);
    }
    return out;
  });
}

function isDuckDbLockError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('cannot open file') && (msg.includes('used by another process') || msg.includes('locked') || msg.includes('already open'));
}

function duckDbLockMessage(dbPath, error) {
  return [
    `DuckDB database is locked: ${dbPath}`,
    'DuckDB mode uses one local database file. Close any other Sora View server windows/processes or other DuckDB tools that may have this file open, then restart Sora View.',
    `Original error: ${error?.message || error}`
  ].join('\n');
}

function createSerializedClient(base) {
  let queue = Promise.resolve();
  function enqueue(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }
  return {
    engine: base.engine,
    all(sql, params = []) { return enqueue(() => base.all(sql, params)); },
    async get(sql, params = []) {
      const rows = await this.all(sql, params);
      return rows[0] || null;
    },
    run(sql, params = []) { return enqueue(() => base.run(sql, params)); },
    exec(sql) { return enqueue(() => base.exec(sql)); },
    async close() {
      await queue.catch(() => {});
      await base.close?.();
    }
  };
}


function ensureSqliteReadSchema(db) {
  try {
    const cols = db.prepare('PRAGMA table_info(videos)').all().map((r) => r.name);
    for (const [name, type] of [['root_post_id','TEXT'], ['like_count','INTEGER'], ['view_count','INTEGER'], ['remix_count','INTEGER'], ['reply_count','INTEGER'], ['share_count','INTEGER'], ['comment_count','INTEGER NOT NULL DEFAULT 0'], ['local_favorite','INTEGER DEFAULT 0'], ['hidden','INTEGER DEFAULT 0'], ['reviewed','INTEGER DEFAULT 0'], ['local_notes','TEXT']]) {
      if (!cols.includes(name)) db.exec(`ALTER TABLE videos ADD COLUMN ${name} ${type}`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS creator_profiles (
        username TEXT PRIMARY KEY,
        display_name TEXT,
        description TEXT,
        follower_count INTEGER,
        following_count INTEGER,
        post_count INTEGER,
        reply_count INTEGER,
        likes_received_count INTEGER,
        remix_count INTEGER,
        cameo_count INTEGER,
        character_count INTEGER,
        raw_json TEXT,
        user_id TEXT,
        verified INTEGER,
        is_public_figure INTEGER,
        permalink TEXT,
        first_seen_at TEXT,
        avatar_ext TEXT
      );
      CREATE TABLE IF NOT EXISTS character_profiles (
        character_name TEXT PRIMARY KEY,
        display_name TEXT,
        owner_username TEXT,
        description TEXT,
        likes_received_count INTEGER,
        remix_count INTEGER,
        cameo_count INTEGER,
        raw_json TEXT
      );
      CREATE TABLE IF NOT EXISTS comments (
        comment_id TEXT PRIMARY KEY,
        parent_post_id TEXT NOT NULL,
        root_post_id TEXT,
        author_username TEXT,
        author_user_id TEXT,
        text TEXT,
        posted_at TEXT,
        updated_at TEXT,
        tombstoned_at TEXT,
        like_count INTEGER,
        dislike_count INTEGER,
        reply_count INTEGER,
        recursive_reply_count INTEGER,
        view_count INTEGER,
        remix_count INTEGER,
        permalink TEXT,
        source TEXT,
        attachments_json TEXT,
        source_file TEXT,
        first_seen_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_post_id);
      CREATE INDEX IF NOT EXISTS idx_comments_root ON comments(root_post_id);
      CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_username);
      CREATE INDEX IF NOT EXISTS idx_comments_posted ON comments(posted_at);
      CREATE INDEX IF NOT EXISTS idx_videos_comment_count ON videos(comment_count);
      CREATE INDEX IF NOT EXISTS idx_creator_profiles_username_lower ON creator_profiles(LOWER(username));
      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS collection_videos (
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (collection_id, video_id)
      );
      CREATE TABLE IF NOT EXISTS creator_summary (
        author TEXT PRIMARY KEY,
        video_count INTEGER NOT NULL DEFAULT 0,
        latest_date TEXT,
        total_views INTEGER NOT NULL DEFAULT 0,
        total_likes INTEGER NOT NULL DEFAULT 0,
        total_remixes INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS character_summary (
        character_name TEXT PRIMARY KEY,
        cast_count INTEGER NOT NULL DEFAULT 0,
        latest_date TEXT,
        total_views INTEGER NOT NULL DEFAULT 0,
        total_likes INTEGER NOT NULL DEFAULT 0,
        total_remixes INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS summary_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_creator_summary_count ON creator_summary(video_count DESC, author);
      CREATE INDEX IF NOT EXISTS idx_character_summary_count ON character_summary(cast_count DESC, character_name);
      CREATE INDEX IF NOT EXISTS idx_videos_hidden_author_date ON videos(hidden, author, date);
      CREATE INDEX IF NOT EXISTS idx_videos_hidden_date ON videos(hidden, date);
      CREATE INDEX IF NOT EXISTS idx_videos_counts ON videos(like_count, view_count);
    `);
    const profileCols = db.prepare('PRAGMA table_info(creator_profiles)').all().map((r) => r.name);
    for (const [name, type] of [['user_id','TEXT'], ['verified','INTEGER'], ['is_public_figure','INTEGER'], ['permalink','TEXT'], ['first_seen_at','TEXT'], ['avatar_ext','TEXT']]) {
      if (!profileCols.includes(name)) db.exec(`ALTER TABLE creator_profiles ADD COLUMN ${name} ${type}`);
    }
  } catch {}
}

async function createDuckClient(dbPath) {
  let mod;
  try {
    mod = await runtimeImport('@duckdb/node-api');
  } catch (importError) {
    // Only fall back to the older duckdb package when the newer package itself
    // cannot be imported. Runtime/open errors such as file locks should not
    // trigger fallback attempts against the same locked database file.
    try {
      const oldMod = await runtimeImport('duckdb');
      const duckdb = oldMod.default || oldMod;
      const db = await new Promise((resolve, reject) => {
        const d = new duckdb.Database(dbPath, (err) => err ? reject(err) : resolve(d));
      });
      const connection = db.connect();
      return createSerializedClient({
        engine: 'duckdb',
        all(sql, params = []) {
          return new Promise((resolve, reject) => {
            connection.all(interpolate(sql, params), (err, rows) => err ? reject(err) : resolve(normalizeRows(rows)));
          });
        },
        run(sql, params = []) {
          return new Promise((resolve, reject) => {
            connection.run(interpolate(sql, params), (err) => err ? reject(err) : resolve({ changes: 0 }));
          });
        },
        exec(sql) {
          return new Promise((resolve, reject) => {
            connection.exec(sql, (err) => err ? reject(err) : resolve());
          });
        },
        async close() {
          try { connection.close?.(); } catch {}
          try { db.close?.(); } catch {}
        },
      });
    } catch (oldError) {
      if (isDuckDbLockError(oldError)) throw new Error(duckDbLockMessage(dbPath, oldError));
      const message = [
        'DuckDB mode requires the optional DuckDB Node package.',
        `Tried @duckdb/node-api: ${importError.message}`,
        `Tried duckdb fallback: ${oldError.message}`,
        'Install dependencies again with npm install, or switch back to SQLite.',
      ].join('\n');
      throw new Error(message);
    }
  }

  try {
    const instance = await mod.DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    return createSerializedClient({
      engine: 'duckdb',
      async all(sql, params = []) {
        const reader = await connection.runAndReadAll(interpolate(sql, params));
        return normalizeRows(reader.getRowObjectsJson());
      },
      async run(sql, params = []) {
        await connection.run(interpolate(sql, params));
        return { changes: 0 };
      },
      async exec(sql) {
        await connection.run(sql);
      },
      async close() {
        try { await connection.close?.(); } catch {}
        try { await instance.close?.(); } catch {}
      },
    });
  } catch (openError) {
    if (isDuckDbLockError(openError)) throw new Error(duckDbLockMessage(dbPath, openError));
    throw openError;
  }
}

export async function closeDB() {
  if (_clientPromise) {
    try { await _clientPromise; } catch {}
    _clientPromise = null;
    _clientPromiseKey = null;
  }
  if (_client) {
    await _client.close?.();
    _client = null;
    _clientKey = null;
  }
}

export async function getDB() {
  const config = getConfig();
  if (!config) throw new Error('No config — setup wizard not completed.');
  const engine = normalizeDbEngine(config.dbEngine);
  const key = `${engine}:${config.dbPath}`;
  if (_client && _clientKey === key) return _client;
  if (_clientPromise && _clientPromiseKey === key) return _clientPromise;
  if (_clientPromise) {
    try { await _clientPromise; } catch {}
    _clientPromise = null;
    _clientPromiseKey = null;
  }
  await closeDB();

  _clientPromiseKey = key;
  _clientPromise = (async () => {
    try {
      let client;
      if (engine === 'duckdb') {
        client = await createDuckClient(config.dbPath);
      } else {
        const db = new Database(config.dbPath, { readonly: false, fileMustExist: true });
        db.pragma('foreign_keys = ON');
        ensureSqliteReadSchema(db);
        client = {
          engine: 'sqlite',
          all(sql, params = []) { return db.prepare(sql).all(...params); },
          get(sql, params = []) { return db.prepare(sql).get(...params) || null; },
          run(sql, params = []) { return db.prepare(sql).run(...params); },
          exec(sql) { return db.exec(sql); },
          close() { db.close(); },
        };
      }
      _client = client;
      _clientKey = key;
      return client;
    } catch (error) {
      _client = null;
      _clientKey = null;
      throw error;
    } finally {
      _clientPromise = null;
      _clientPromiseKey = null;
    }
  })();

  return _clientPromise;
}


function personInfoLevel(options = {}) {
  const value = String(options.personIndexInfo || options.detail || 'minimal').toLowerCase();
  return ['minimal', 'profile', 'rich'].includes(value) ? value : 'minimal';
}

function wantsProfileJoin(options = {}) {
  return personInfoLevel(options) !== 'minimal';
}

function wantsRichPeopleInfo(options = {}) {
  return personInfoLevel(options) === 'rich';
}

async function summaryCount(db, table) {
  try { return Number((await db.get(`SELECT COUNT(*) AS n FROM ${table}`))?.n || 0); }
  catch { return 0; }
}

async function metaValue(db, key) {
  try { return String((await db.get('SELECT value FROM summary_meta WHERE key = ?', [key]))?.value || ''); }
  catch { return ''; }
}

async function setMetaValue(db, key, value) {
  if (db.engine === 'duckdb') {
    await db.run('DELETE FROM summary_meta WHERE key = ?', [key]);
    await db.run('INSERT INTO summary_meta (key, value) VALUES (?, ?)', [key, String(value)]);
  } else {
    await db.run('INSERT OR REPLACE INTO summary_meta (key, value) VALUES (?, ?)', [key, String(value)]);
  }
}

/**
 * Re-compute videos.comment_count from the comments table. This denormalizes
 * COUNT(*) per post so summary aggregations and "most-commented" listings
 * don't need a join. Cheap — single set-based UPDATE keyed on the indexed
 * post_id / parent_post_id columns.
 */
export async function refreshVideoCommentCounts(dbArg = null) {
  const db = dbArg || (await getDB());
  // Skip silently if comments table doesn't exist (legacy DB).
  try { await db.get('SELECT 1 FROM comments LIMIT 1'); } catch { return { updated: 0 }; }
  if (db.engine === 'duckdb') {
    await db.exec(`
      UPDATE videos SET comment_count = COALESCE((
        SELECT COUNT(*) FROM comments c WHERE c.parent_post_id = videos.post_id
      ), 0)
      WHERE post_id IS NOT NULL AND post_id != ''
    `);
  } else {
    await db.run(`
      UPDATE videos SET comment_count = COALESCE((
        SELECT COUNT(*) FROM comments c WHERE c.parent_post_id = videos.post_id
      ), 0)
      WHERE post_id IS NOT NULL AND post_id != ''
    `);
  }
  return { updated: Number((await db.get('SELECT COUNT(*) AS n FROM videos WHERE COALESCE(comment_count,0) > 0'))?.n || 0) };
}

export async function rebuildPersonSummaries() {
  const db = await getDB();
  const duck = db.engine === 'duckdb';

  // Refresh denormalized comment_count on videos before summary aggregation —
  // counts come from the comments table populated during ingest.
  await refreshVideoCommentCounts(db);

  if (duck) {
    // DuckDB optimization: rebuild summaries with set-oriented CTAS/OR REPLACE
    // instead of row-by-row maintenance. These are compact tables used by the
    // People, Creators, and Characters index pages.
    await db.exec(`
      CREATE OR REPLACE TABLE creator_summary AS
      SELECT
        author,
        COUNT(*)::INTEGER AS video_count,
        MAX(date) AS latest_date,
        SUM(COALESCE(view_count, 0))::BIGINT AS total_views,
        SUM(COALESCE(like_count, 0))::BIGINT AS total_likes,
        SUM(COALESCE(remix_count, 0))::BIGINT AS total_remixes,
        SUM(COALESCE(comment_count, 0))::BIGINT AS total_comments
      FROM videos
      WHERE author IS NOT NULL AND author != '' AND COALESCE(hidden,0)=0
      GROUP BY author;

      CREATE OR REPLACE TABLE character_summary AS
      SELECT
        c.character_name,
        COUNT(*)::INTEGER AS cast_count,
        MAX(v.date) AS latest_date,
        SUM(COALESCE(v.view_count, 0))::BIGINT AS total_views,
        SUM(COALESCE(v.like_count, 0))::BIGINT AS total_likes,
        SUM(COALESCE(v.remix_count, 0))::BIGINT AS total_remixes,
        SUM(COALESCE(v.comment_count, 0))::BIGINT AS total_comments
      FROM cameos c
      JOIN videos v ON v.id = c.video_id
      WHERE c.character_name IS NOT NULL AND c.character_name != '' AND COALESCE(v.hidden,0)=0
      GROUP BY c.character_name;

      CREATE TABLE IF NOT EXISTS summary_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS creator_summary (
        author TEXT PRIMARY KEY,
        video_count INTEGER NOT NULL DEFAULT 0,
        latest_date TEXT,
        total_views INTEGER NOT NULL DEFAULT 0,
        total_likes INTEGER NOT NULL DEFAULT 0,
        total_remixes INTEGER NOT NULL DEFAULT 0,
        total_comments INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS character_summary (
        character_name TEXT PRIMARY KEY,
        cast_count INTEGER NOT NULL DEFAULT 0,
        latest_date TEXT,
        total_views INTEGER NOT NULL DEFAULT 0,
        total_likes INTEGER NOT NULL DEFAULT 0,
        total_remixes INTEGER NOT NULL DEFAULT 0,
        total_comments INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS summary_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    for (const [table, cols] of [['creator_summary', ['total_views','total_likes','total_remixes','total_comments']], ['character_summary', ['total_views','total_likes','total_remixes','total_comments']]]) {
      try {
        const existing = await db.all(`PRAGMA table_info(${table})`);
        const names = new Set(existing.map((r) => r.name));
        for (const col of cols) {
          if (!names.has(col)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
        }
      } catch {}
    }
    await db.run('DELETE FROM creator_summary');
    await db.run('DELETE FROM character_summary');
    await db.run(`
      INSERT INTO creator_summary (author, video_count, latest_date, total_views, total_likes, total_remixes, total_comments)
      SELECT author, COUNT(*) AS video_count, MAX(date) AS latest_date,
             SUM(COALESCE(view_count, 0)) AS total_views,
             SUM(COALESCE(like_count, 0)) AS total_likes,
             SUM(COALESCE(remix_count, 0)) AS total_remixes,
             SUM(COALESCE(comment_count, 0)) AS total_comments
      FROM videos
      WHERE author IS NOT NULL AND author != '' AND COALESCE(hidden,0)=0
      GROUP BY author
    `);
    await db.run(`
      INSERT INTO character_summary (character_name, cast_count, latest_date, total_views, total_likes, total_remixes, total_comments)
      SELECT c.character_name, COUNT(*) AS cast_count, MAX(v.date) AS latest_date,
             SUM(COALESCE(v.view_count, 0)) AS total_views,
             SUM(COALESCE(v.like_count, 0)) AS total_likes,
             SUM(COALESCE(v.remix_count, 0)) AS total_remixes,
             SUM(COALESCE(v.comment_count, 0)) AS total_comments
      FROM cameos c
      JOIN videos v ON v.id = c.video_id
      WHERE c.character_name IS NOT NULL AND c.character_name != '' AND COALESCE(v.hidden,0)=0
      GROUP BY c.character_name
    `);
  }

  const videoCount = Number((await db.get('SELECT COUNT(*) AS n FROM videos'))?.n || 0);
  const cameoCount = Number((await db.get('SELECT COUNT(*) AS n FROM cameos'))?.n || 0);
  const hiddenCount = Number((await db.get('SELECT COUNT(*) AS n FROM videos WHERE COALESCE(hidden,0)=1'))?.n || 0);
  await setMetaValue(db, 'videos_count', videoCount);
  await setMetaValue(db, 'cameos_count', cameoCount);
  await setMetaValue(db, 'hidden_count', hiddenCount);
  await setMetaValue(db, 'summary_built_at', new Date().toISOString());
  await setMetaValue(db, 'summary_engine', db.engine);
  return {
    creators: await summaryCount(db, 'creator_summary'),
    characters: await summaryCount(db, 'character_summary'),
    videos: videoCount,
    cameos: cameoCount,
    engine: db.engine,
  };
}

async function ensurePersonSummaries() {
  const db = await getDB();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS creator_summary (author TEXT PRIMARY KEY, video_count INTEGER NOT NULL DEFAULT 0, latest_date TEXT, total_views INTEGER DEFAULT 0, total_likes INTEGER DEFAULT 0, total_remixes INTEGER DEFAULT 0, total_comments INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS character_summary (character_name TEXT PRIMARY KEY, cast_count INTEGER NOT NULL DEFAULT 0, latest_date TEXT, total_views INTEGER DEFAULT 0, total_likes INTEGER DEFAULT 0, total_remixes INTEGER DEFAULT 0, total_comments INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS summary_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE INDEX IF NOT EXISTS idx_creator_summary_author_lower ON creator_summary(LOWER(author));
    CREATE INDEX IF NOT EXISTS idx_character_summary_name_lower ON character_summary(LOWER(character_name));
  `);
  try {
    await db.get('SELECT total_views, total_likes, total_remixes, total_comments FROM creator_summary LIMIT 1');
    await db.get('SELECT total_views, total_likes, total_remixes, total_comments FROM character_summary LIMIT 1');
  } catch {
    return rebuildPersonSummaries();
  }
  const videoCount = Number((await db.get('SELECT COUNT(*) AS n FROM videos'))?.n || 0);
  const cameoCount = Number((await db.get('SELECT COUNT(*) AS n FROM cameos'))?.n || 0);
  const hiddenCount = Number((await db.get('SELECT COUNT(*) AS n FROM videos WHERE COALESCE(hidden,0)=1'))?.n || 0);
  const creatorRows = await summaryCount(db, 'creator_summary');
  const characterRows = await summaryCount(db, 'character_summary');
  if (
    String(videoCount) !== await metaValue(db, 'videos_count') ||
    String(cameoCount) !== await metaValue(db, 'cameos_count') ||
    String(hiddenCount) !== await metaValue(db, 'hidden_count') ||
    (videoCount > 0 && creatorRows === 0) ||
    (cameoCount > 0 && characterRows === 0)
  ) {
    return rebuildPersonSummaries();
  }
  return { creators: creatorRows, characters: characterRows, videos: videoCount, cameos: cameoCount };
}

function likeEscape(value) {
  return String(value).replace(/[\\%_]/g, (m) => `\\${m}`);
}

function stem(filename = '') {
  return String(filename).replace(/\.[^.]+$/, '');
}

function remixPathCandidates(filePath = '') {
  const normalized = String(filePath).replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const candidates = [];
  if (parts[0] === 'sora_v2_remixes') {
    if (parts[1] === 'parents' && parts.length > 4) candidates.push(parts[3]);
    if (parts[1] === 'downstream') {
      if (parts[2]) candidates.push(parts[2]);
      if (parts[3] && !/\.(mp4|webm|mov|m4v)$/i.test(parts[3])) candidates.push(parts[3]);
    }
  }
  const file = parts.at(-1) || '';
  const base = stem(file);
  if (base) candidates.push(base);
  return [...new Set(candidates.filter(Boolean).filter((x) => String(x).length >= 6))];
}

function remixIdentityCandidates(video) {
  if (!video) return [];
  const candidates = [
    video.post_id,
    video.generation_id,
    video.task_id,
    video.filename ? stem(video.filename) : null,
    video.parent_post_id,
    video.parent_generation_id,
    video.parent_task_id,
    ...remixPathCandidates(video.file_path),
  ];
  return [...new Set(candidates.filter(Boolean).map((x) => String(x).trim()).filter((x) => x.length >= 6))];
}

async function withCameos(rows) {
  if (!rows || rows.length === 0) return rows;
  const db = await getDB();
  const ids = rows.map((r) => r.id);
  const cameosById = new Map(ids.map((id) => [id, []]));
  const placeholders = ids.map(() => '?').join(',');
  const cameoRows = await db.all(`SELECT video_id, character_name FROM cameos WHERE video_id IN (${placeholders}) ORDER BY character_name`, ids);
  for (const row of cameoRows) {
    if (!cameosById.has(row.video_id)) cameosById.set(row.video_id, []);
    cameosById.get(row.video_id).push(row.character_name);
  }
  return rows.map((row) => ({ ...row, cameos: cameosById.get(row.id) || [] }));
}

const VIDEO_SELECT = `id, filename, file_path, author, date, duration_s,
           width, height, prompt, source_dir, liked, generation_id, task_id,
           post_id, parent_post_id, root_post_id, parent_generation_id, parent_task_id,
           like_count, view_count, remix_count, reply_count, share_count, comment_count,
           thumbnail_path, preview_path, local_favorite, hidden, reviewed`;

export async function getVideos({ page = 1, sourceDir = null, author = null, randomSeed = null, pageSize = PAGE_SIZE, feedMode = 'all' } = {}) {
  const db = await getDB();
  const offset = (page - 1) * pageSize;
  const where = [];
  const params = [];
  where.push('COALESCE(hidden,0) = 0');
  if (sourceDir) { where.push('source_dir = ?'); params.push(sourceDir); }
  if (author) { where.push('author = ?'); params.push(author); }
  if (feedMode === 'favorites') where.push('COALESCE(local_favorite,0) = 1');
  if (feedMode === 'reviewed') where.push('COALESCE(reviewed,0) = 1');
  if (feedMode === 'high_likes') where.push('COALESCE(like_count,0) > 0');
  if (feedMode === 'high_views') where.push('COALESCE(view_count,0) > 0');
  let orderBy = feedMode === 'high_likes' ? 'COALESCE(like_count,0) DESC, date DESC, id DESC' : feedMode === 'high_views' ? 'COALESCE(view_count,0) DESC, date DESC, id DESC' : 'date DESC, id DESC';
  if (randomSeed !== null && randomSeed !== undefined && String(randomSeed) !== '') {
    const seed = Math.max(1, Math.abs(parseInt(randomSeed, 10) || 1));
    orderBy = db.engine === 'duckdb'
      ? '((CAST(id AS BIGINT) * CAST(? AS BIGINT)) % 2147483647), id'
      : '((id * ?) % 2147483647), id';
    params.push(seed);
  }
  params.push(pageSize, offset);
  const rows = await db.all(`SELECT ${VIDEO_SELECT} FROM videos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, params);
  return withCameos(rows);
}

export async function getVideo(id) {
  const db = await getDB();
  const video = await db.get(`SELECT * FROM videos WHERE id = ?`, [id]);
  if (!video) return null;
  const cameos = await db.all('SELECT character_name FROM cameos WHERE video_id = ? ORDER BY character_name', [id]);
  video.cameos = cameos.map((r) => r.character_name);
  video.cameo_list = video.cameos.join(',');
  return video;
}

export async function searchVideos({ q = '', author = '', dateFrom = '', dateTo = '', character = '', minLikes = '', minViews = '', page = 1, pageSize = PAGE_SIZE } = {}) {
  const db = await getDB();
  const offset = (page - 1) * pageSize;
  const where = ['COALESCE(v.hidden,0) = 0'];
  const params = [];
  if (q) {
    where.push(`(
      v.prompt LIKE ?
      OR v.author LIKE ?
      OR v.filename LIKE ?
      OR v.generation_id LIKE ?
      OR v.post_id LIKE ?
      OR EXISTS (SELECT 1 FROM cameos cq WHERE cq.video_id = v.id AND cq.character_name LIKE ?)
    )`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${String(q).replace(/^@/, '')}%`);
  }
  if (author) { where.push('v.author = ?'); params.push(author); }
  if (dateFrom) { where.push('v.date >= ?'); params.push(dateFrom); }
  if (dateTo) { where.push('v.date <= ?'); params.push(dateTo); }
  if (character) {
    where.push('EXISTS (SELECT 1 FROM cameos c WHERE c.video_id = v.id AND c.character_name = ?)');
    params.push(character.toLowerCase());
  }
  const minLikesNum = Number.parseInt(minLikes, 10);
  if (Number.isFinite(minLikesNum) && minLikesNum > 0) {
    where.push('COALESCE(v.like_count, 0) >= ?');
    params.push(minLikesNum);
  }
  const minViewsNum = Number.parseInt(minViews, 10);
  if (Number.isFinite(minViewsNum) && minViewsNum > 0) {
    where.push('COALESCE(v.view_count, 0) >= ?');
    params.push(minViewsNum);
  }
  params.push(pageSize, offset);
  const rows = await db.all(`SELECT ${VIDEO_SELECT.split(',').map(s => 'v.' + s.trim()).join(', ')} FROM videos v ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.date DESC, v.id DESC LIMIT ? OFFSET ?`, params);
  return withCameos(rows);
}

export async function getCreators(q = '', sort = 'videos', { limit = 100, offset = 0, personIndexInfo = 'minimal' } = {}) {
  await ensurePersonSummaries();
  const db = await getDB();
  const params = [];
  const joinProfiles = wantsProfileJoin({ personIndexInfo });
  const rich = wantsRichPeopleInfo({ personIndexInfo });
  let where = `WHERE cs.author IS NOT NULL AND cs.author != ''`;
  if (q) {
    where += joinProfiles ? ` AND (cs.author LIKE ? OR cp.display_name LIKE ?)` : ` AND cs.author LIKE ?`;
    params.push(`%${q}%`);
    if (joinProfiles) params.push(`%${q}%`);
  }
  const orderBy = sort === 'name'
    ? 'LOWER(cs.author) ASC, cs.video_count DESC'
    : 'cs.video_count DESC, LOWER(cs.author) ASC';
  const profileSelect = joinProfiles
    ? `cp.display_name${rich ? `, cp.description, cp.follower_count, cp.following_count, cp.post_count, cp.reply_count, cp.likes_received_count, cp.remix_count, cp.cameo_count, cp.character_count` : `, NULL AS description, NULL AS follower_count, NULL AS following_count, NULL AS post_count, NULL AS reply_count, NULL AS likes_received_count, NULL AS remix_count, NULL AS cameo_count, NULL AS character_count`}`
    : `NULL AS display_name, NULL AS description, NULL AS follower_count, NULL AS following_count, NULL AS post_count, NULL AS reply_count, NULL AS likes_received_count, NULL AS remix_count, NULL AS cameo_count, NULL AS character_count`;
  params.push(limit, offset);
  return db.all(`
    SELECT cs.author, cs.video_count, cs.latest_date, COALESCE(cs.total_views,0) AS total_views, COALESCE(cs.total_likes,0) AS total_likes, COALESCE(cs.total_remixes,0) AS total_remixes,
           ${profileSelect}
    FROM creator_summary cs
    ${joinProfiles ? 'LEFT JOIN creator_profiles cp ON lower(cp.username) = lower(cs.author)' : ''}
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `, params);
}

export async function getCharacters(page = 1, q = '', pageSize = PAGE_SIZE, offsetOverride = null, { personIndexInfo = 'minimal' } = {}) {
  await ensurePersonSummaries();
  const db = await getDB();
  const joinProfiles = wantsProfileJoin({ personIndexInfo });
  const rich = wantsRichPeopleInfo({ personIndexInfo });
  const params = [];
  let where = '';
  if (q) {
    where = joinProfiles ? 'WHERE cs.character_name LIKE ? OR cp.display_name LIKE ? OR cp.owner_username LIKE ?' : 'WHERE cs.character_name LIKE ?';
    params.push(`%${q}%`);
    if (joinProfiles) params.push(`%${q}%`, `%${q}%`);
  }
  const profileSelect = joinProfiles
    ? `cp.display_name, cp.owner_username${rich ? `, cp.description, cp.likes_received_count, cp.remix_count, cp.cameo_count` : `, NULL AS description, NULL AS likes_received_count, NULL AS remix_count, NULL AS cameo_count`}`
    : `NULL AS display_name, NULL AS owner_username, NULL AS description, NULL AS likes_received_count, NULL AS remix_count, NULL AS cameo_count`;
  params.push(pageSize, offsetOverride ?? ((page - 1) * pageSize));
  return db.all(`
    SELECT cs.character_name, cs.cast_count, COALESCE(cs.total_views,0) AS total_views, COALESCE(cs.total_likes,0) AS total_likes, COALESCE(cs.total_remixes,0) AS total_remixes,
           ${profileSelect}
    FROM character_summary cs
    ${joinProfiles ? 'LEFT JOIN character_profiles cp ON lower(cp.character_name) = lower(cs.character_name)' : ''}
    ${where}
    ORDER BY cs.cast_count DESC, cs.character_name
    LIMIT ? OFFSET ?
  `, params);
}

export async function getCreatorVideos(author, sourceDir = null, page = 1, pageSize = PAGE_SIZE) {
  return getVideos({ page, author, sourceDir, pageSize });
}

export async function getCharacterVideos(character, page = 1, pageSize = PAGE_SIZE) {
  const db = await getDB();
  const rows = await db.all(`
    SELECT ${VIDEO_SELECT.split(',').map(s => 'v.' + s.trim()).join(', ')}
    FROM videos v
    JOIN cameos c ON c.video_id = v.id
    WHERE lower(c.character_name) = lower(?) AND COALESCE(v.hidden,0) = 0
    ORDER BY v.date DESC, v.id DESC
    LIMIT ? OFFSET ?
  `, [String(character).toLowerCase(), pageSize, (page - 1) * pageSize]);
  return withCameos(rows);
}

export async function getProfileVideos(sourceDir, page = 1, pageSize = PAGE_SIZE) {
  return getVideos({ page, sourceDir, pageSize });
}

export async function getRemixParents({ page = 1, pageSize = PAGE_SIZE } = {}) {
  const db = await getDB();
  const rows = await db.all(`
    SELECT ${VIDEO_SELECT}
    FROM videos
    WHERE source_dir = 'remix_parent' AND COALESCE(hidden,0) = 0
    ORDER BY date DESC, id DESC
    LIMIT ? OFFSET ?
  `, [pageSize, (page - 1) * pageSize]);
  return withCameos(rows);
}

export async function getRemixesForVideo(videoOrId, { limit = 120 } = {}) {
  const db = await getDB();
  const video = typeof videoOrId === 'object' ? videoOrId : await getVideo(videoOrId);
  if (!video) return [];

  const where = ["v.id != ?", "v.source_dir IN ('remix_downstream', 'remix')"];
  const params = [video.id];
  const match = [];
  for (const value of remixIdentityCandidates(video)) {
    match.push('v.parent_post_id = ?'); params.push(value);
    match.push('v.parent_generation_id = ?'); params.push(value);
    match.push('v.parent_task_id = ?'); params.push(value);
    match.push("v.file_path LIKE ? ESCAPE '\\'"); params.push(`%${likeEscape(value)}%`);
    match.push('v.post_id = ?'); params.push(value);
    match.push('v.generation_id = ?'); params.push(value);
    match.push('v.task_id = ?'); params.push(value);
  }
  if (!match.length) return [];
  where.push(`(${match.join(' OR ')})`);
  params.push(limit);

  const rows = await db.all(`
    SELECT ${VIDEO_SELECT.split(',').map(s => 'v.' + s.trim()).join(', ')}
    FROM videos v
    WHERE ${where.join(' AND ')}
    ORDER BY v.date DESC, v.id DESC
    LIMIT ?
  `, params);
  return withCameos(rows);
}

export async function optimizeDatabase() {
  const db = await getDB();
  const started = Date.now();
  const result = { engine: db.engine, summary: null, maintenance: [], elapsedMs: 0 };

  // Rebuild the precomputed person indexes first. These are the most visible
  // performance win for People/Creators/Characters pages.
  result.summary = await rebuildPersonSummaries();

  if (db.engine === 'duckdb') {
    // DuckDB is strongest at batch/analytical operations. Keep page loads
    // summary-first, then run lightweight maintenance commands that are safe
    // across current DuckDB releases.
    for (const stmt of ['CHECKPOINT', 'ANALYZE']) {
      try {
        await db.exec(stmt);
        result.maintenance.push(stmt);
      } catch (e) {
        result.maintenance.push(`${stmt} skipped: ${e.message}`);
      }
    }
  } else {
    for (const stmt of ['PRAGMA optimize', 'ANALYZE']) {
      try {
        await db.exec(stmt);
        result.maintenance.push(stmt);
      } catch (e) {
        result.maintenance.push(`${stmt} skipped: ${e.message}`);
      }
    }
  }

  result.elapsedMs = Date.now() - started;
  return result;
}

export async function getStats() {
  const db = await getDB();
  const [total, creators, chars, liked, remixParent, remixDownstream, withManifest, withSidecar, withFallback, withPrompt, withCameos, explicitProfiles, favorites, hidden, reviewed] = await Promise.all([
    db.get('SELECT COUNT(*) as n FROM videos'),
    db.get("SELECT COUNT(DISTINCT author) as n FROM videos WHERE author IS NOT NULL"),
    db.get('SELECT COUNT(DISTINCT character_name) as n FROM cameos'),
    db.get("SELECT COUNT(*) as n FROM videos WHERE source_dir = 'liked'"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE source_dir = 'remix_parent'"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE source_dir = 'remix_downstream'"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE metadata_source IN ('soravault_manifest','soravault_remix_manifest','extracted_json')"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE has_txt = 1"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE metadata_source = 'filename_path'"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE prompt IS NOT NULL AND prompt != ''"),
    db.get("SELECT COUNT(DISTINCT video_id) as n FROM cameos"),
    db.get("SELECT COUNT(*) as n FROM creator_profiles"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE COALESCE(local_favorite,0)=1"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE COALESCE(hidden,0)=1"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE COALESCE(reviewed,0)=1"),
  ]);
  return {
    total: total?.n || 0,
    creators: creators?.n || 0,
    chars: chars?.n || 0,
    liked: liked?.n || 0,
    remix_parent: remixParent?.n || 0,
    remix_downstream: remixDownstream?.n || 0,
    with_manifest: withManifest?.n || 0,
    with_sidecar: withSidecar?.n || 0,
    with_fallback: withFallback?.n || 0,
    with_prompt: withPrompt?.n || 0,
    with_cameos: withCameos?.n || 0,
    explicit_profiles: explicitProfiles?.n || 0,
    favorites: favorites?.n || 0,
    hidden: hidden?.n || 0,
    reviewed: reviewed?.n || 0,
  };
}


export async function getAssetHealth() {
  const db = await getDB();
  const [total, withThumb, withPreview, noThumb, noPreview, profileImages] = await Promise.all([
    db.get('SELECT COUNT(*) as n FROM videos'),
    db.get("SELECT COUNT(*) as n FROM videos WHERE thumbnail_path IS NOT NULL AND thumbnail_path != ''"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE preview_path IS NOT NULL AND preview_path != ''"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE thumbnail_path IS NULL OR thumbnail_path = ''"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE preview_path IS NULL OR preview_path = ''"),
    db.get("SELECT COUNT(DISTINCT author) as n FROM videos WHERE author IS NOT NULL AND author != ''"),
  ]);
  return {
    total: total?.n || 0,
    withThumb: withThumb?.n || 0,
    withPreview: withPreview?.n || 0,
    missingThumb: noThumb?.n || 0,
    missingPreview: noPreview?.n || 0,
    creators: profileImages?.n || 0,
  };
}

export async function getProfileCounts() {
  const db = await getDB();
  const [profile, drafts, liked] = await Promise.all([
    db.get("SELECT COUNT(*) as n FROM videos WHERE source_dir='profile'"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE source_dir='drafts'"),
    db.get("SELECT COUNT(*) as n FROM videos WHERE source_dir='liked'"),
  ]);
  return { profile: profile?.n || 0, drafts: drafts?.n || 0, liked: liked?.n || 0 };
}

export async function inferOwnerUsername() {
  const db = await getDB();
  const row = await db.get(`
    SELECT author, COUNT(*) AS n
    FROM videos
    WHERE source_dir = 'profile' AND author IS NOT NULL AND author != ''
    GROUP BY author
    ORDER BY n DESC
    LIMIT 1
  `);
  return row?.author || null;
}

export async function getCreatorInfo(username) {
  const db = await getDB();
  return db.get(`
    SELECT v.author, COUNT(*) as video_count, MAX(v.date) as latest_date,
           cp.display_name, cp.description, cp.follower_count, cp.following_count,
           cp.post_count, cp.reply_count, cp.likes_received_count, cp.remix_count,
           cp.cameo_count, cp.character_count
    FROM videos v
    LEFT JOIN creator_profiles cp ON lower(cp.username) = lower(v.author)
    WHERE lower(v.author) = lower(?)
    GROUP BY v.author, cp.display_name, cp.description, cp.follower_count, cp.following_count,
             cp.post_count, cp.reply_count, cp.likes_received_count, cp.remix_count,
             cp.cameo_count, cp.character_count
  `, [username]);
}

export async function getCharacterInfo(name) {
  const db = await getDB();
  return db.get(`
    SELECT c.character_name, COUNT(*) as cast_count,
           cp.display_name, cp.owner_username, cp.description,
           cp.likes_received_count, cp.remix_count, cp.cameo_count
    FROM cameos c
    LEFT JOIN character_profiles cp ON lower(cp.character_name) = lower(c.character_name)
    WHERE lower(c.character_name) = lower(?)
    GROUP BY c.character_name, cp.display_name, cp.owner_username, cp.description,
             cp.likes_received_count, cp.remix_count, cp.cameo_count
  `, [name]);
}

export async function getCreatorCharacters(username, { limit = 500 } = {}) {
  const db = await getDB();
  return db.all(`
    SELECT c.character_name, COUNT(*) AS video_count, MAX(v.date) AS latest_date,
           cp.display_name, cp.owner_username, cp.description,
           cp.likes_received_count, cp.remix_count, cp.cameo_count
    FROM cameos c
    JOIN videos v ON v.id = c.video_id
    LEFT JOIN character_profiles cp ON lower(cp.character_name) = lower(c.character_name)
    WHERE lower(v.author) = lower(?)
    GROUP BY c.character_name, cp.display_name, cp.owner_username, cp.description,
             cp.likes_received_count, cp.remix_count, cp.cameo_count
    ORDER BY video_count DESC, c.character_name
    LIMIT ?
  `, [username, limit]);
}

export async function getCharacterCoStars(name, { limit = 24 } = {}) {
  const db = await getDB();
  return db.all(`
    SELECT other.character_name, COUNT(*) AS shared_count,
           cp.display_name, cp.owner_username
    FROM cameos base
    JOIN cameos other ON other.video_id = base.video_id AND other.character_name != base.character_name
    LEFT JOIN character_profiles cp ON lower(cp.character_name) = lower(other.character_name)
    WHERE lower(base.character_name) = lower(?) AND COALESCE((SELECT hidden FROM videos WHERE id = base.video_id),0)=0
    GROUP BY other.character_name, cp.display_name, cp.owner_username
    ORDER BY shared_count DESC, other.character_name
    LIMIT ?
  `, [name, limit]);
}

export async function getCharacterCreators(name, { limit = 200 } = {}) {
  const db = await getDB();
  return db.all(`
    SELECT v.author, COUNT(*) AS video_count, MAX(v.date) AS latest_date,
           cp.display_name
    FROM cameos c
    JOIN videos v ON v.id = c.video_id
    LEFT JOIN creator_profiles cp ON lower(cp.username) = lower(v.author)
    WHERE lower(c.character_name) = lower(?) AND COALESCE(v.hidden,0)=0 AND v.author IS NOT NULL AND v.author != ''
    GROUP BY v.author, cp.display_name
    ORDER BY video_count DESC, v.author
    LIMIT ?
  `, [name, limit]);
}

export async function getPeople(q = '', sort = 'videos', { limit = 100, offset = 0, personIndexInfo = 'minimal' } = {}) {
  await ensurePersonSummaries();
  const db = await getDB();
  const joinProfiles = wantsProfileJoin({ personIndexInfo });
  const search = q ? `%${q}%` : null;
  const creatorWhere = search
    ? (joinProfiles ? `WHERE cs.author LIKE ? OR cp.display_name LIKE ?` : `WHERE cs.author LIKE ?`)
    : '';
  const charWhere = search
    ? (joinProfiles ? `WHERE chs.character_name LIKE ? OR ch.display_name LIKE ? OR ch.owner_username LIKE ?` : `WHERE chs.character_name LIKE ?`)
    : '';
  const creatorParams = search ? (joinProfiles ? [search, search] : [search]) : [];
  const charParams = search ? (joinProfiles ? [search, search, search] : [search]) : [];
  const orderBy = sort === 'name'
    ? 'LOWER(name) ASC, video_count DESC, kind ASC'
    : 'video_count DESC, LOWER(name) ASC, kind ASC';
  const creatorDisplay = joinProfiles ? 'cp.display_name' : 'NULL AS display_name';
  const charDisplay = joinProfiles ? 'ch.display_name' : 'NULL AS display_name';
  const charOwner = joinProfiles ? 'ch.owner_username' : 'NULL AS owner_username';
  return db.all(`
    SELECT * FROM (
      SELECT 'creator' AS kind, cs.author AS name, ${creatorDisplay}, NULL AS owner_username,
             cs.video_count AS video_count, cs.latest_date AS latest_date
      FROM creator_summary cs
      ${joinProfiles ? 'LEFT JOIN creator_profiles cp ON lower(cp.username) = lower(cs.author)' : ''}
      ${creatorWhere}
      UNION ALL
      SELECT 'character' AS kind, chs.character_name AS name, ${charDisplay}, ${charOwner},
             chs.cast_count AS video_count, chs.latest_date AS latest_date
      FROM character_summary chs
      ${joinProfiles ? 'LEFT JOIN character_profiles ch ON lower(ch.character_name) = lower(chs.character_name)' : ''}
      ${charWhere}
    ) people
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `, [...creatorParams, ...charParams, limit, offset]);
}


export async function setVideoLocalState(id, updates = {}) {
  const db = await getDB();
  const allowed = ['local_favorite', 'hidden', 'reviewed'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      sets.push(`${key} = ?`);
      params.push(updates[key] ? 1 : 0);
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'local_notes')) {
    sets.push('local_notes = ?');
    params.push(String(updates.local_notes || ''));
  }
  if (!sets.length) return getVideo(id);
  params.push(id);
  await db.run(`UPDATE videos SET ${sets.join(', ')} WHERE id = ?`, params);
  return getVideo(id);
}

export async function getCollections() {
  const db = await getDB();
  return db.all(`
    SELECT c.id, c.name, c.created_at, COUNT(cv.video_id) AS video_count, MAX(v.date) AS latest_date
    FROM collections c
    LEFT JOIN collection_videos cv ON cv.collection_id = c.id
    LEFT JOIN videos v ON v.id = cv.video_id
    GROUP BY c.id, c.name, c.created_at
    ORDER BY lower(c.name) ASC
  `);
}

export async function getCollectionsForVideo(videoId) {
  if (!videoId) return [];
  const db = await getDB();
  return db.all(`
    SELECT c.id, c.name, cv.added_at
    FROM collections c
    JOIN collection_videos cv ON cv.collection_id = c.id
    WHERE cv.video_id = ?
    ORDER BY lower(c.name) ASC
  `, [videoId]);
}

export async function createCollection(name) {
  const db = await getDB();
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Collection name is required.');
  if (db.engine === 'duckdb') {
    await db.run(`INSERT INTO collections (name) VALUES (?) ON CONFLICT DO NOTHING`, [clean]);
  } else {
    await db.run(`INSERT OR IGNORE INTO collections (name) VALUES (?)`, [clean]);
  }
  return db.get(`SELECT * FROM collections WHERE lower(name) = lower(?)`, [clean]);
}

export async function addVideoToCollection(collectionId, videoId) {
  const db = await getDB();
  if (db.engine === 'duckdb') await db.run(`INSERT INTO collection_videos (collection_id, video_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [collectionId, videoId]);
  else await db.run(`INSERT OR IGNORE INTO collection_videos (collection_id, video_id) VALUES (?, ?)`, [collectionId, videoId]);
  return { ok: true };
}

export async function removeVideoFromCollection(collectionId, videoId) {
  const db = await getDB();
  await db.run(`DELETE FROM collection_videos WHERE collection_id = ? AND video_id = ?`, [collectionId, videoId]);
  return { ok: true };
}

export async function getCollection(id) {
  const db = await getDB();
  return db.get(`SELECT * FROM collections WHERE id = ?`, [id]);
}

export async function getCollectionVideos(id, page = 1, pageSize = PAGE_SIZE) {
  const db = await getDB();
  const rows = await db.all(`
    SELECT ${VIDEO_SELECT.split(',').map(s => 'v.' + s.trim()).join(', ')}
    FROM videos v
    JOIN collection_videos cv ON cv.video_id = v.id
    WHERE cv.collection_id = ? AND COALESCE(v.hidden,0)=0
    ORDER BY cv.added_at DESC, v.id DESC
    LIMIT ? OFFSET ?
  `, [id, pageSize, (page - 1) * pageSize]);
  return withCameos(rows);
}

export async function getDuplicateCandidates({ limit = 50 } = {}) {
  const db = await getDB();
  const byGeneration = await db.all(`
    SELECT 'generation_id' AS reason, generation_id AS match_key, COUNT(*) AS n
    FROM videos
    WHERE generation_id IS NOT NULL AND generation_id != ''
    GROUP BY generation_id
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT ?
  `, [limit]);
  const byPost = await db.all(`
    SELECT 'post_id' AS reason, post_id AS match_key, COUNT(*) AS n
    FROM videos
    WHERE post_id IS NOT NULL AND post_id != ''
    GROUP BY post_id
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT ?
  `, [limit]);
  return [...byGeneration, ...byPost].slice(0, limit);
}

export async function getTimelineStats() {
  const db = await getDB();
  return db.all(`
    SELECT substr(date,1,7) AS month, COUNT(*) AS video_count, SUM(COALESCE(view_count,0)) AS views, SUM(COALESCE(like_count,0)) AS likes
    FROM videos
    WHERE date IS NOT NULL AND date != ''
    GROUP BY substr(date,1,7)
    ORDER BY month DESC
    LIMIT 72
  `);
}

export async function getSimilarVideos(id, { limit = 12 } = {}) {
  const db = await getDB();
  const video = await getVideo(id);
  if (!video) return [];
  const cameos = video.cameos || [];
  const where = ['v.id != ?', 'COALESCE(v.hidden,0)=0'];
  const params = [id];
  const ors = [];
  if (video.author) { ors.push('v.author = ?'); params.push(video.author); }
  if (video.root_post_id) { ors.push('v.root_post_id = ?'); params.push(video.root_post_id); }
  for (const c of cameos.slice(0, 8)) { ors.push('EXISTS (SELECT 1 FROM cameos cx WHERE cx.video_id = v.id AND cx.character_name = ?)'); params.push(c); }
  if (!ors.length) return [];
  where.push('(' + ors.join(' OR ') + ')');
  params.push(limit);
  const rows = await db.all(`SELECT ${VIDEO_SELECT.split(',').map(s => 'v.' + s.trim()).join(', ')} FROM videos v WHERE ${where.join(' AND ')} ORDER BY v.date DESC, v.id DESC LIMIT ?`, params);
  return withCameos(rows);
}

const COMMENT_SELECT = `c.comment_id, c.parent_post_id, c.root_post_id, c.author_username, c.author_user_id,
                         c.text, c.posted_at, c.updated_at, c.tombstoned_at,
                         c.like_count, c.dislike_count, c.reply_count, c.recursive_reply_count,
                         c.view_count, c.remix_count, c.permalink, c.source, c.attachments_json,
                         cp.display_name AS author_display_name, cp.verified AS author_verified`;

export async function getCommentsForPost(postId, { limit = 100 } = {}) {
  if (!postId) return [];
  const db = await getDB();
  return db.all(`
    SELECT ${COMMENT_SELECT}
    FROM comments c
    LEFT JOIN creator_profiles cp ON lower(cp.username) = lower(c.author_username)
    WHERE c.parent_post_id = ?
    ORDER BY COALESCE(c.like_count, 0) DESC, c.posted_at DESC
    LIMIT ?
  `, [postId, limit]);
}

export async function getCommentsForVideo(videoId, { limit = 100 } = {}) {
  const db = await getDB();
  const video = await db.get('SELECT post_id FROM videos WHERE id = ?', [videoId]);
  if (!video?.post_id) return [];
  return getCommentsForPost(video.post_id, { limit });
}

export async function getCommentReplies(commentId, { limit = 200 } = {}) {
  if (!commentId) return [];
  const db = await getDB();
  return db.all(`
    SELECT ${COMMENT_SELECT}
    FROM comments c
    LEFT JOIN creator_profiles cp ON lower(cp.username) = lower(c.author_username)
    WHERE c.parent_post_id = ?
    ORDER BY COALESCE(c.like_count, 0) DESC, c.posted_at ASC
    LIMIT ?
  `, [commentId, limit]);
}

export async function getCommentCount(postId) {
  if (!postId) return 0;
  const db = await getDB();
  const row = await db.get('SELECT COUNT(*) AS n FROM comments WHERE parent_post_id = ?', [postId]);
  return Number(row?.n || 0);
}

export async function getCommentStats() {
  const db = await getDB();
  try {
    // Detect comments table existence — older DBs may not have it.
    await db.get('SELECT 1 FROM comments LIMIT 1');
  } catch {
    return null;
  }
  const [total, uniqueAuthors, withReplies, tombstoned, withAttachments, withMedia, distinctPosts, linkedVideos, sourceFiles, topThread, topAuthor] = await Promise.all([
    db.get('SELECT COUNT(*) AS n FROM comments'),
    db.get('SELECT COUNT(DISTINCT author_username) AS n FROM comments WHERE author_username IS NOT NULL'),
    db.get('SELECT COUNT(*) AS n FROM comments WHERE COALESCE(reply_count,0) > 0'),
    db.get('SELECT COUNT(*) AS n FROM comments WHERE tombstoned_at IS NOT NULL'),
    db.get("SELECT COUNT(*) AS n FROM comments WHERE attachments_json IS NOT NULL AND attachments_json != ''"),
    db.get("SELECT COUNT(*) AS n FROM comments WHERE attachments_json IS NOT NULL AND attachments_json != '' AND attachments_json != '[]'"),
    db.get('SELECT COUNT(DISTINCT parent_post_id) AS n FROM comments'),
    db.get(`SELECT COUNT(DISTINCT v.id) AS n FROM videos v WHERE v.post_id IS NOT NULL AND v.post_id IN (SELECT DISTINCT parent_post_id FROM comments)`),
    db.get('SELECT COUNT(DISTINCT source_file) AS n FROM comments WHERE source_file IS NOT NULL'),
    db.get(`SELECT parent_post_id, COUNT(*) AS n FROM comments GROUP BY parent_post_id ORDER BY n DESC LIMIT 1`),
    db.get(`SELECT author_username, COUNT(*) AS n FROM comments WHERE author_username IS NOT NULL GROUP BY author_username ORDER BY n DESC LIMIT 1`),
  ]);
  return {
    total: Number(total?.n || 0),
    uniqueAuthors: Number(uniqueAuthors?.n || 0),
    withReplies: Number(withReplies?.n || 0),
    tombstoned: Number(tombstoned?.n || 0),
    withAttachments: Number(withMedia?.n || withAttachments?.n || 0),
    distinctPosts: Number(distinctPosts?.n || 0),
    linkedVideos: Number(linkedVideos?.n || 0),
    sourceFiles: Number(sourceFiles?.n || 0),
    topThreadPostId: topThread?.parent_post_id || null,
    topThreadCount: Number(topThread?.n || 0),
    topAuthor: topAuthor?.author_username || null,
    topAuthorCount: Number(topAuthor?.n || 0),
  };
}

export async function getAvatarStats() {
  const db = await getDB();
  // creator_profiles.avatar_ext is populated during the comments ingest phase
  // (recordAvatarExt + reconcileAvatarRegistry). One DB read replaces a
  // multi-second filesystem walk.
  try { await db.get('SELECT avatar_ext FROM creator_profiles LIMIT 1'); }
  catch { return null; }
  const totals = await db.get(`
    SELECT
      COUNT(*) AS profiles,
      SUM(CASE WHEN avatar_ext IS NOT NULL AND avatar_ext != '' THEN 1 ELSE 0 END) AS with_avatar
    FROM creator_profiles
  `);
  const byExtRows = await db.all(`
    SELECT LOWER(avatar_ext) AS ext, COUNT(*) AS n
    FROM creator_profiles
    WHERE avatar_ext IS NOT NULL AND avatar_ext != ''
    GROUP BY LOWER(avatar_ext)
    ORDER BY n DESC
  `);
  const profiles = Number(totals?.profiles || 0);
  const withAvatar = Number(totals?.with_avatar || 0);
  const byExt = Object.create(null);
  for (const row of byExtRows) byExt[row.ext] = Number(row.n);
  return { profiles, withAvatar, missing: profiles - withAvatar, byExt };
}

export async function getProfileStats() {
  const db = await getDB();
  await ensurePersonSummaries();
  // Use the small creator_summary table (~5x smaller than videos) for the
  // "has videos" join. The previous version used correlated EXISTS subqueries
  // with LOWER() against videos which defeated the author index — 19s on a
  // 13k-video / 6k-profile archive. This rewrite is single-digit ms.
  const [counts, mostFollowed] = await Promise.all([
    db.get(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN COALESCE(cp.verified,0) = 1 THEN 1 ELSE 0 END) AS verified,
        SUM(CASE WHEN cp.description IS NOT NULL AND cp.description != '' THEN 1 ELSE 0 END) AS with_description,
        SUM(CASE WHEN cp.user_id IS NOT NULL AND cp.user_id != '' THEN 1 ELSE 0 END) AS with_user_id,
        SUM(CASE WHEN cs.author IS NOT NULL THEN 1 ELSE 0 END) AS with_videos,
        SUM(CASE WHEN cs.author IS NULL THEN 1 ELSE 0 END) AS commenters_only
      FROM creator_profiles cp
      LEFT JOIN creator_summary cs ON LOWER(cs.author) = LOWER(cp.username)
    `),
    db.get(`SELECT username, follower_count FROM creator_profiles
            WHERE follower_count IS NOT NULL ORDER BY follower_count DESC LIMIT 1`),
  ]);
  return {
    total: Number(counts?.total || 0),
    verified: Number(counts?.verified || 0),
    withDescription: Number(counts?.with_description || 0),
    withUserId: Number(counts?.with_user_id || 0),
    commentersOnly: Number(counts?.commenters_only || 0),
    withVideos: Number(counts?.with_videos || 0),
    mostFollowed: mostFollowed?.username || null,
    mostFollowedCount: Number(mostFollowed?.follower_count || 0),
  };
}

export async function getMostCommentedVideos({ page = 1, pageSize = PAGE_SIZE, minComments = 1 } = {}) {
  const db = await getDB();
  const offset = (page - 1) * pageSize;
  const min = Math.max(0, Number(minComments) || 0);
  const rows = await db.all(`
    SELECT ${VIDEO_SELECT}
    FROM videos
    WHERE COALESCE(hidden,0) = 0 AND COALESCE(comment_count,0) >= ?
    ORDER BY COALESCE(comment_count,0) DESC, date DESC, id DESC
    LIMIT ? OFFSET ?
  `, [min, pageSize, offset]);
  return withCameos(rows);
}

export async function getMostCommentedTotal({ minComments = 1 } = {}) {
  const db = await getDB();
  const min = Math.max(0, Number(minComments) || 0);
  const row = await db.get('SELECT COUNT(*) AS n FROM videos WHERE COALESCE(hidden,0) = 0 AND COALESCE(comment_count,0) >= ?', [min]);
  return Number(row?.n || 0);
}

export async function getHiddenVideos(page = 1, pageSize = PAGE_SIZE) {
  const db = await getDB();
  const rows = await db.all(`SELECT ${VIDEO_SELECT} FROM videos WHERE COALESCE(hidden,0)=1 ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`, [pageSize, (page - 1) * pageSize]);
  return withCameos(rows);
}

export async function getFavoriteVideos(page = 1, pageSize = PAGE_SIZE) {
  const db = await getDB();
  const rows = await db.all(`SELECT ${VIDEO_SELECT} FROM videos WHERE COALESCE(local_favorite,0)=1 AND COALESCE(hidden,0)=0 ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`, [pageSize, (page - 1) * pageSize]);
  return withCameos(rows);
}
