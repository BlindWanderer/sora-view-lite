import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { readdir, mkdir } from 'fs/promises';

// Native optional packages such as DuckDB contain .node binaries. Keep these
// imports opaque to Vite/Rollup so production builds do not try to parse native
// binary files. Runtime resolution still happens from node_modules.
const runtimeImport = Function('specifier', 'return import(specifier)');
function normalizeDbEngine(value) { return String(value || '').toLowerCase() === 'duckdb' ? 'duckdb' : 'sqlite'; }

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const PREVIEW_EXTENSIONS = ['.gif', '.webp'];
const MAX_JSON_BYTES = 250 * 1024 * 1024;

function yieldToServer() {
  return new Promise((resolve) => setImmediate(resolve));
}

function quoteSql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}
function interpolate(sql, params = []) { let i = 0; return sql.replace(/\?/g, () => quoteSql(params[i++])); }
function normalizeRows(rows) { return (rows || []).map((row) => { const out = { ...row }; for (const [k, v] of Object.entries(out)) if (typeof v === 'bigint') out[k] = Number(v); return out; }); }

async function createDuckWriteClient(dbPath) {
  try {
    const mod = await runtimeImport('@duckdb/node-api');
    const instance = await mod.DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    return {
      engine: 'duckdb',
      async exec(sql) { await connection.run(sql); },
      async run(sql, params = []) { await connection.run(interpolate(sql, params)); return { changes: 0, lastInsertRowid: null }; },
      async get(sql, params = []) { const r = await connection.runAndReadAll(interpolate(sql, params)); return normalizeRows(r.getRowObjectsJson())[0] || null; },
      async all(sql, params = []) { const r = await connection.runAndReadAll(interpolate(sql, params)); return normalizeRows(r.getRowObjectsJson()); },
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
        exec(sql) { return new Promise((resolve, reject) => con.exec(sql, (err) => err ? reject(err) : resolve())); },
        run(sql, params = []) { return new Promise((resolve, reject) => con.run(interpolate(sql, params), (err) => err ? reject(err) : resolve({ changes: 0 }))); },
        all(sql, params = []) { return new Promise((resolve, reject) => con.all(interpolate(sql, params), (err, rows) => err ? reject(err) : resolve(normalizeRows(rows)))); },
        async get(sql, params = []) { const rows = await this.all(sql, params); return rows[0] || null; },
        async close() { try { con.close?.(); } catch {} try { db.close?.(); } catch {} },
      };
    } catch (oldError) {
      throw new Error(`DuckDB mode requires optional dependencies. @duckdb/node-api failed: ${newerError.message}; duckdb fallback failed: ${oldError.message}`);
    }
  }
}

async function openWriteClient(dbPath, dbEngine) {
  if (normalizeDbEngine(dbEngine) === 'duckdb') return createDuckWriteClient(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return {
    engine: 'sqlite',
    exec(sql) { db.exec(sql); },
    run(sql, params = []) { return db.prepare(sql).run(...params); },
    get(sql, params = []) { return db.prepare(sql).get(...params) || null; },
    all(sql, params = []) { return db.prepare(sql).all(...params); },
    close() { db.close(); },
  };
}

export async function createSchema(db) {
  if (db.engine === 'duckdb') {
    await db.exec(`
      CREATE SEQUENCE IF NOT EXISTS videos_id_seq START 1;
      CREATE SEQUENCE IF NOT EXISTS cameos_id_seq START 1;
      CREATE SEQUENCE IF NOT EXISTS collections_id_seq START 1;
      CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY DEFAULT nextval('videos_id_seq'),
        file_path TEXT UNIQUE NOT NULL,
        file_size BIGINT,
        filename TEXT,
        generation_id TEXT,
        task_id TEXT,
        post_id TEXT,
        parent_post_id TEXT,
        root_post_id TEXT,
        parent_generation_id TEXT,
        parent_task_id TEXT,
        author TEXT,
        date TEXT,
        duration_s DOUBLE,
        width INTEGER,
        height INTEGER,
        aspect_ratio TEXT,
        liked INTEGER,
        like_count INTEGER,
        view_count INTEGER,
        remix_count INTEGER,
        reply_count INTEGER,
        share_count INTEGER,
        comment_count INTEGER DEFAULT 0,
        prompt TEXT,
        source TEXT,
        source_dir TEXT,
        thumbnail_path TEXT,
        preview_path TEXT,
        metadata_source TEXT,
        has_txt INTEGER DEFAULT 0,
        local_favorite INTEGER DEFAULT 0,
        hidden INTEGER DEFAULT 0,
        reviewed INTEGER DEFAULT 0,
        local_notes TEXT,
        ingested_at TIMESTAMP DEFAULT current_timestamp
      );
      CREATE TABLE IF NOT EXISTS cameos (
        id INTEGER PRIMARY KEY DEFAULT nextval('cameos_id_seq'),
        video_id INTEGER NOT NULL,
        character_name TEXT NOT NULL,
        UNIQUE(video_id, character_name)
      );
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
      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY DEFAULT nextval('collections_id_seq'),
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT current_timestamp
      );
      CREATE TABLE IF NOT EXISTS collection_videos (
        collection_id INTEGER NOT NULL,
        video_id INTEGER NOT NULL,
        added_at TIMESTAMP DEFAULT current_timestamp,
        PRIMARY KEY (collection_id, video_id)
      );
    `);
    const cols = await db.all(`PRAGMA table_info(videos)`);
    const names = cols.map((r) => r.name);
    for (const [name, type] of [['thumbnail_path','TEXT'], ['preview_path','TEXT'], ['metadata_source','TEXT'], ['root_post_id','TEXT'], ['like_count','INTEGER'], ['view_count','INTEGER'], ['remix_count','INTEGER'], ['reply_count','INTEGER'], ['share_count','INTEGER'], ['comment_count','INTEGER DEFAULT 0'], ['local_favorite','INTEGER DEFAULT 0'], ['hidden','INTEGER DEFAULT 0'], ['reviewed','INTEGER DEFAULT 0'], ['local_notes','TEXT']]) {
      if (!names.includes(name)) await db.exec(`ALTER TABLE videos ADD COLUMN ${name} ${type}`);
    }
    const profileCols = (await db.all(`PRAGMA table_info(creator_profiles)`)).map((r) => r.name);
    for (const [name, type] of [['user_id','TEXT'], ['verified','INTEGER'], ['is_public_figure','INTEGER'], ['permalink','TEXT'], ['first_seen_at','TEXT'], ['avatar_ext','TEXT']]) {
      if (!profileCols.includes(name)) await db.exec(`ALTER TABLE creator_profiles ADD COLUMN ${name} ${type}`);
    }
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL UNIQUE,
      file_size INTEGER,
      filename TEXT,
      generation_id TEXT,
      task_id TEXT,
      post_id TEXT,
      parent_post_id TEXT,
      root_post_id TEXT,
      parent_generation_id TEXT,
      parent_task_id TEXT,
      author TEXT,
      date TEXT,
      duration_s REAL,
      width INTEGER,
      height INTEGER,
      aspect_ratio TEXT,
      liked INTEGER,
      like_count INTEGER,
      view_count INTEGER,
      remix_count INTEGER,
      reply_count INTEGER,
      share_count INTEGER,
      comment_count INTEGER NOT NULL DEFAULT 0,
      prompt TEXT,
      source TEXT,
      source_dir TEXT,
      thumbnail_path TEXT,
      preview_path TEXT,
      metadata_source TEXT,
      has_txt INTEGER NOT NULL DEFAULT 0,
      local_favorite INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      reviewed INTEGER NOT NULL DEFAULT 0,
      local_notes TEXT,
      ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cameos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      character_name TEXT NOT NULL,
      UNIQUE(video_id, character_name)
    );
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
    CREATE INDEX IF NOT EXISTS idx_author ON videos(author);
    CREATE INDEX IF NOT EXISTS idx_date ON videos(date);
    CREATE INDEX IF NOT EXISTS idx_generation_id ON videos(generation_id);
    CREATE INDEX IF NOT EXISTS idx_post_id ON videos(post_id);
    CREATE INDEX IF NOT EXISTS idx_parent_post ON videos(parent_post_id);
    CREATE INDEX IF NOT EXISTS idx_root_post ON videos(root_post_id);
    CREATE INDEX IF NOT EXISTS idx_source_dir ON videos(source_dir);
    CREATE INDEX IF NOT EXISTS idx_cameo_name ON cameos(character_name);
    CREATE INDEX IF NOT EXISTS idx_cameo_video ON cameos(video_id);
    CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_root ON comments(root_post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_username);
    CREATE INDEX IF NOT EXISTS idx_comments_posted ON comments(posted_at);
    CREATE INDEX IF NOT EXISTS idx_videos_comment_count ON videos(comment_count);
    CREATE INDEX IF NOT EXISTS idx_creator_profiles_username_lower ON creator_profiles(LOWER(username));
  `);
  const cols = db.all ? await db.all(`PRAGMA table_info(videos)`) : [];
  const names = cols.map((r) => r.name);
  for (const [name, type] of [['thumbnail_path','TEXT'], ['preview_path','TEXT'], ['metadata_source','TEXT'], ['root_post_id','TEXT'], ['like_count','INTEGER'], ['view_count','INTEGER'], ['remix_count','INTEGER'], ['reply_count','INTEGER'], ['share_count','INTEGER'], ['comment_count','INTEGER NOT NULL DEFAULT 0'], ['local_favorite','INTEGER DEFAULT 0'], ['hidden','INTEGER DEFAULT 0'], ['reviewed','INTEGER DEFAULT 0'], ['local_notes','TEXT']]) {
    if (!names.includes(name)) await db.exec(`ALTER TABLE videos ADD COLUMN ${name} ${type}`);
  }
  const profileCols = (await db.all(`PRAGMA table_info(creator_profiles)`)).map((r) => r.name);
  for (const [name, type] of [['user_id','TEXT'], ['verified','INTEGER'], ['is_public_figure','INTEGER'], ['permalink','TEXT'], ['first_seen_at','TEXT'], ['avatar_ext','TEXT']]) {
    if (!profileCols.includes(name)) await db.exec(`ALTER TABLE creator_profiles ADD COLUMN ${name} ${type}`);
  }
}

function unixSecondsToDate(value) {
  if (!value && value !== 0) return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
function isoToDate(value) { return value ? String(value).slice(0, 10) : null; }
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function aspectRatio(w, h) { if (!w || !h) return null; const g = gcd(Number(w), Number(h)); return `${w / g}:${h / g}`; }
function slugify(text) { return String(text || '').replace(/@\S+/g, '').replace(/[^\w\s-]/g, ' ').trim().replace(/\s+/g, '_').replace(/_+/g, '_').toLowerCase() || 'no_prompt'; }
function humanizeStem(value) {
  return String(value || '').replace(/\.[^.]+$/, '').replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/^(gen_[a-z0-9]+|s_[a-z0-9]+|task_[a-z0-9]+)_?/i, '').replace(/_\d{4}-\d{2}-\d{2}_?/g, '_').replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function normalizeStem(value) {
  return String(value || '').replace(/\.[^.]+$/, '').toLowerCase().replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/_\d{4}-\d{2}-\d{2}(?=_|$)/, '').replace(/\.thumb$/, '').replace(/\.gif$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function buildBasename(date, id, prompt) { return normalizeStem(`${date || 'nodate'}_${id || 'noid'}_${slugify(prompt)}`); }
function addIndex(map, key, meta) { if (!key) return; const k = normalizeStem(key); if (!k || k.length < 4) return; if (!map.has(k)) map.set(k, []); map.get(k).push(meta); }
function addKey(map, key, meta) { if (!key) return; const k = String(key).trim().toLowerCase(); if (!k || k.length < 4) return; if (!map.has(k)) map.set(k, []); map.get(k).push(meta); }
function addGroup(map, key, meta) { if (!key) return; const k = String(key).trim().toLowerCase(); if (!k || k.length < 4) return; if (!map.has(k)) map.set(k, []); map.get(k).push(meta); }
function authorKey(value) { return String(value || '').trim().toLowerCase(); }
function dateKey(value) { return String(value || '').slice(0, 10); }
function promptKey(value) { return normalizeStem(value || '').replace(/^(prompt|no_prompt|noid|nodate)_?/,''); }
function tokenSet(value) { return new Set(promptKey(value).split('_').filter((x) => x.length >= 3)); }
function similarity(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(A.size, B.size);
}
function chooseBestByTitle(rows = [], title = '') {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  const scored = rows.map((row) => ({ row, score: similarity(title, row.prompt || '') }))
    .sort((a, b) => b.score - a.score || (b.row._priority || 0) - (a.row._priority || 0));
  if (scored[0]?.score >= 0.35) return scored[0].row;
  return null;
}
function extractIdsFromName(filename) {
  const text = String(filename || '');
  return {
    generation_id: text.match(/gen_[a-z0-9]+/i)?.[0] || null,
    task_id: text.match(/task_[a-z0-9]+/i)?.[0] || null,
    post_id: text.match(/s_[a-z0-9]+/i)?.[0] || null,
    date: text.match(/(?:^|_)(\d{4}-\d{2}-\d{2})(?:_|\.)/)?.[1] || null,
  };
}
function cleanAuthor(value) { return value ? String(value).trim() : null; }

export function sourceDir(relPath) {
  const parts = relPath.split(path.sep).map((p) => p.toLowerCase());
  const top = parts[0];
  switch (top) {
    case 'sora_v2_creator':
    case 'sora_v2_creators': return 'creators';
    case 'sora_v2_liked': return 'liked';
    case 'sora_v2_profile': return 'profile';
    case 'sora_v2_drafts': return 'drafts';
    case 'downloads':
    case 'sora_downloads': return 'downloads';
    case 'mirror_browse': return 'mirror_browse';
    case 'sora_v2_remixes': {
      if (parts[1] === 'parents') return 'remix_parent';
      if (parts[1] === 'downstream') return 'remix_downstream';
      return 'remix';
    }
    default: return 'unknown';
  }
}

const CREATOR_PARENTS = new Set(['sora_v2_creator', 'sora_v2_creators', 'sora_v2_liked', 'sora_v2_profile', 'sora_v2_drafts', 'downloads', 'sora_downloads']);
export function authorFromPath(relPath) {
  const parts = relPath.split(path.sep);
  const lower = parts.map((p) => p.toLowerCase());
  if (lower[0] === 'sora_v2_remixes') {
    if (lower[1] === 'parents' && parts[2] && !VIDEO_EXTENSIONS.has(path.extname(parts[2]).toLowerCase())) return parts[2];
    return null;
  }
  for (let i = 0; i < parts.length - 1; i++) {
    if (CREATOR_PARENTS.has(lower[i])) {
      const candidate = parts[i + 1];
      if (candidate && !VIDEO_EXTENSIONS.has(path.extname(candidate).toLowerCase())) return candidate;
    }
  }
  return null;
}

function isMentionNameChar(ch) {
  return /^[\p{L}\p{N}._-]$/u.test(ch);
}

function isMentionBoundaryChar(ch) {
  if (!ch) return true;
  // If @ is in the middle of a token, treat it as email/user@host-style text,
  // not a Sora character mention. This still allows "(@name", " @name",
  // quotes, dashes, and line starts.
  return !/^[\p{L}\p{N}._-]$/u.test(ch);
}

export function extractCameos(prompt) {
  if (!prompt) return [];
  const text = String(prompt);
  const found = new Set();

  // Manual scanner instead of a single regex so handles with dots/underscores are
  // preserved reliably across all prompt sources. Examples:
  //   @robertoch.meadow
  //   @sora_bear
  //   @star.bear.wearingahat
  //   (@robertteddy @markmam @lizzy) ... @leom.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    const prev = i > 0 ? text[i - 1] : '';
    if (!isMentionBoundaryChar(prev)) continue;

    let j = i + 1;
    let raw = '';
    while (j < text.length && isMentionNameChar(text[j])) {
      raw += text[j];
      j++;
    }

    let name = raw
      .replace(/^[._-]+/gu, '')
      .replace(/[._-]+$/gu, '')
      .trim()
      .toLowerCase();

    if (!name || name.length < 2) continue;
    if (!/[\p{L}\p{N}]/u.test(name)) continue;
    if (/^(http|https|www|gmail|email|mailto)$/i.test(name)) continue;

    found.add(name);
  }

  return [...found];
}
function cameoNames(list = []) {
  const names = [];
  for (const c of list || []) {
    if (c?.username) names.push(c.username.toLowerCase());
    if (c?.display_name) names.push(String(c.display_name).toLowerCase());
  }
  return [...new Set(names.filter(Boolean))];
}

function facetMentionNames(list = []) {
  const names = [];
  for (const f of list || []) {
    const p = f?.profile || f?.user || f?.target || f;
    if (p?.username) names.push(String(p.username).toLowerCase());
    if (f?.username) names.push(String(f.username).toLowerCase());
    if (typeof f?.text === 'string' && f.text.startsWith('@')) names.push(...extractCameos(f.text));
  }
  return [...new Set(names.filter(Boolean))];
}

function profileMeta(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const username = cleanAuthor(profile.username || profile.author || profile.creatorUsername);
  if (!username) return null;
  return {
    username: username.toLowerCase(),
    display_name: profile.display_name || null,
    description: profile.description || null,
    follower_count: profile.follower_count ?? null,
    following_count: profile.following_count ?? null,
    post_count: profile.post_count ?? null,
    reply_count: profile.reply_count ?? null,
    likes_received_count: profile.likes_received_count ?? null,
    remix_count: profile.remix_count ?? null,
    cameo_count: profile.cameo_count ?? null,
    character_count: profile.character_count ?? null,
    raw_json: JSON.stringify(profile),
  };
}

function characterProfileMeta(character) {
  if (!character || typeof character !== 'object') return null;
  const username = cleanAuthor(character.username || character.character_name || character.display_name);
  if (!username) return null;
  const owner = profileMeta(character.owner || character.owner_profile);
  return {
    character_name: username.toLowerCase(),
    display_name: character.display_name || null,
    owner_username: owner?.username || null,
    description: character.description || null,
    likes_received_count: character.likes_received_count ?? null,
    remix_count: character.remix_count ?? null,
    cameo_count: character.cameo_count ?? null,
    raw_json: JSON.stringify(character),
    _ownerProfile: owner,
  };
}

function collectProfileMetas(...values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const meta = profileMeta(value);
    if (meta && !seen.has(meta.username)) { seen.add(meta.username); out.push(meta); }
  }
  return out;
}

function collectCharacterProfileMetas(list = []) {
  const out = [];
  const seen = new Set();
  for (const c of list || []) {
    const meta = characterProfileMeta(c);
    if (meta && !seen.has(meta.character_name)) {
      seen.add(meta.character_name);
      out.push(meta);
      if (meta._ownerProfile && !seen.has(`profile:${meta._ownerProfile.username}`)) {
        // Owner profiles are returned separately by caller through _ownerProfile.
      }
    }
  }
  return out;
}

function postCounts(post = {}) {
  return {
    like_count: post.like_count ?? null,
    view_count: post.view_count ?? post.unique_view_count ?? null,
    remix_count: post.remix_count ?? null,
    reply_count: post.reply_count ?? null,
    share_count: post.share_count ?? null,
  };
}

export function parseTxt(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const result = { metadata_source: 'sidecar_txt', _priority: 40 };
  const promptHeader = text.search(/^\s*[-─]+\s*Prompt\b.*$/im);
  let headerBlock = text, promptBlock = '';
  if (promptHeader !== -1) {
    headerBlock = text.slice(0, promptHeader);
    const promptStart = text.indexOf('\n', promptHeader);
    promptBlock = promptStart !== -1 ? text.slice(promptStart + 1).trim() : '';
  } else {
    const blankIdx = text.indexOf('\n\n');
    headerBlock = blankIdx !== -1 ? text.slice(0, blankIdx) : text;
    promptBlock = blankIdx !== -1 ? text.slice(blankIdx + 2).trim() : '';
  }
  for (const line of headerBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, '_');
    const val = line.slice(colonIdx + 1).trim();
    if (!val) continue;
    if (key === 'source') result.source = val;
    else if (key === 'generation_id') result.generation_id = val;
    else if (key === 'task_id') result.task_id = val;
    else if (key === 'post_id') result.post_id = val;
    else if (['parent_post_id','parent_post','parent_id','source_post_id','remix_parent','remix_source','remix_child'].includes(key)) result.parent_post_id = val;
    else if (['parent_generation_id','source_generation_id'].includes(key)) result.parent_generation_id = val;
    else if (['parent_task_id','source_task_id'].includes(key)) result.parent_task_id = val;
    else if (key === 'date') result.date = val;
    else if (key === 'author') result.author = val;
    else if (key === 'duration') { const d = parseFloat(val); if (!Number.isNaN(d)) result.duration_s = d; }
    else if (key === 'resolution') { const m = val.match(/(\d+)\s*[x×]\s*(\d+)/i); if (m) { result.width = +m[1]; result.height = +m[2]; } }
    else if (key === 'aspect_ratio') result.aspect_ratio = val;
    else if (key === 'liked') result.liked = ['yes','true','1'].includes(val.toLowerCase()) ? 1 : 0;
  }
  if (promptBlock) result.prompt = promptBlock;
  result._cameos = extractCameos(result.prompt);
  return result;
}

async function* walk(dir) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

function companionTextPath(videoPath) { const ext = path.extname(videoPath); return videoPath.slice(0, -ext.length) + '.txt'; }
function findLocalAsset(videoPath, kind) {
  const dir = path.dirname(videoPath);
  const ext = path.extname(videoPath);
  const base = path.basename(videoPath, ext);
  const candidates = [];
  if (kind === 'thumb') {
    for (const e of IMAGE_EXTENSIONS) { candidates.push(path.join(dir, `${base}${e}`)); candidates.push(path.join(dir, `${base}.thumb${e}`)); }
  } else {
    for (const e of PREVIEW_EXTENSIONS) { candidates.push(path.join(dir, `${base}${e}`)); candidates.push(path.join(dir, `${base}.gif${e}`)); candidates.push(path.join(dir, `${base}.preview${e}`)); }
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function metaFromPostVideo(post, video, source, priority = 90) {
  const w = video.width || video.width_px;
  const h = video.height || video.height_px;
  const prompt = post.text ?? video.prompt ?? post.caption ?? '';
  return {
    generation_id: video.generation_id || video.genId || null,
    task_id: video.task_id || video.taskId || null,
    post_id: post.post_id || post.id || null,
    author: cleanAuthor(post.author?.username || post.profile?.username || post.author || post.creatorUsername),
    date: isoToDate(post.posted_at) || unixSecondsToDate(post.posted_at) || isoToDate(post.date),
    duration_s: video.duration_s ?? video.duration ?? video.duration_secs ?? null,
    width: w ?? null,
    height: h ?? null,
    aspect_ratio: aspectRatio(w, h),
    liked: post.user_liked === true ? 1 : post.user_liked === false ? 0 : null,
    ...postCounts(post),
    prompt,
    source,
    metadata_source: source,
    parent_post_id: post.parent_post_id || null,
    root_post_id: post.root_post_id || null,
    parent_generation_id: null,
    parent_task_id: null,
    _cameos: [...new Set([...extractCameos(prompt), ...cameoNames(post.cameo_profiles), ...facetMentionNames(post.text_facets)])],
    _profiles: collectProfileMetas(post.author, post.profile),
    _characterProfiles: collectCharacterProfileMetas(post.cameo_profiles),
    _priority: priority,
  };
}

function metaFromCreatorItem(item, priority = 70) {
  const raw = item._raw || {};
  const post = raw.post || {};
  const profile = raw.profile || {};
  const attachment = (post.attachments || []).find((a) => (a.tags || []).includes('sora')) || (post.attachments || [])[0] || {};
  const w = item.width || attachment.width;
  const h = item.height || attachment.height;
  const prompt = item.prompt ?? post.text ?? attachment.prompt ?? '';
  return {
    generation_id: attachment.generation_id || item.generation_id || (/^gen_/.test(item.genId || '') ? item.genId : null),
    attachment_id: attachment.id || item.genId || null,
    task_id: item.taskId || attachment.task_id || null,
    post_id: item.postId || post.id || null,
    author: cleanAuthor(profile.username || item.author || item.creatorUsername || raw.profile?.username),
    date: item.date || unixSecondsToDate(post.posted_at) || isoToDate(post.posted_at),
    duration_s: item.duration ?? attachment.duration_s ?? null,
    width: w ?? null,
    height: h ?? null,
    aspect_ratio: item.ratio || aspectRatio(w, h),
    liked: item.isLiked === true ? 1 : item.isLiked === false ? 0 : post.user_liked === true ? 1 : post.user_liked === false ? 0 : null,
    // Prefer the nested raw post counts when available. Some manifest summary
    // fields are present but zero even when raw.post has the real public stats.
    like_count: post.like_count ?? item.likeCount ?? null,
    view_count: post.view_count ?? item.viewCount ?? item.view_count ?? null,
    remix_count: post.remix_count ?? item.remixCount ?? item.remix_count ?? null,
    reply_count: post.reply_count ?? item.replyCount ?? item.reply_count ?? null,
    share_count: post.share_count ?? item.shareCount ?? item.share_count ?? null,
    prompt,
    source: item.source || 'soravault_manifest',
    metadata_source: 'soravault_manifest',
    parent_post_id: post.parent_post_id || null,
    root_post_id: post.root_post_id || null,
    _cameos: [...new Set([...extractCameos(prompt), ...cameoNames(post.cameo_profiles), ...facetMentionNames(post.text_facets)])],
    _profiles: collectProfileMetas(profile, post.profile, raw.profile),
    _characterProfiles: collectCharacterProfileMetas(post.cameo_profiles),
    _priority: priority,
  };
}

function metaFromChain(chain, attachment, priority = 80) {
  const post = chain.raw?.post || {};
  const profile = chain.raw?.profile || {};
  const prompt = chain.prompt ?? post.text ?? attachment.prompt ?? '';
  const w = attachment.width;
  const h = attachment.height;
  return {
    generation_id: attachment.generation_id || null,
    attachment_id: attachment.id || null,
    task_id: attachment.task_id || null,
    post_id: post.id || chain.parentPostId || null,
    author: cleanAuthor(profile.username || chain.creatorUsername),
    date: isoToDate(chain.capturedAt) || unixSecondsToDate(post.posted_at),
    duration_s: attachment.duration_s ?? null,
    width: w ?? null,
    height: h ?? null,
    aspect_ratio: aspectRatio(w, h),
    liked: post.user_liked === true ? 1 : post.user_liked === false ? 0 : null,
    ...postCounts(post),
    prompt,
    source: chain.source || 'soravault_remix_manifest',
    metadata_source: 'soravault_remix_manifest',
    parent_post_id: chain.direction === 'parent' ? post.parent_post_id || chain.parentPostId || null : chain.parentPostId || post.parent_post_id || null,
    root_post_id: chain.rootPostId || post.root_post_id || null,
    parent_generation_id: chain.direction === 'parent' ? chain.childPostId || null : null,
    parent_task_id: null,
    _cameos: [...new Set([...extractCameos(prompt), ...cameoNames(post.cameo_profiles), ...facetMentionNames(post.text_facets)])],
    _profiles: collectProfileMetas(profile, chain.raw?.profile, post.profile),
    _characterProfiles: collectCharacterProfileMetas(post.cameo_profiles),
    _priority: priority,
  };
}

async function buildMetadataIndexes(jsonFiles, stats, onProgress = () => {}, rootDir = '') {
  const byId = new Map();
  const byStem = new Map();
  const byAuthorDate = new Map();
  const byAuthor = new Map();
  let parsed = 0;
  for (const file of jsonFiles) {
    try {
      parsed++;
      stats.currentFile = rootDir ? path.relative(rootDir, file) : file;
      if (parsed % 10 === 1) onProgress({ ...stats, phase: 'parsing_metadata' });
      const st = fs.statSync(file);
      if (st.size > MAX_JSON_BYTES) continue;
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      stats.manifestsFound++;
      if (Array.isArray(manifest.posts)) {
        for (const post of manifest.posts) {
          for (const video of post.videos || []) {
            const meta = metaFromPostVideo(post, video, 'extracted_json', 90);
            indexMeta(meta, byId, byStem, byAuthorDate, byAuthor);
          }
        }
      } else if (Array.isArray(manifest.items)) {
        for (const item of manifest.items) indexMeta(metaFromCreatorItem(item), byId, byStem, byAuthorDate, byAuthor);
      } else if (Array.isArray(manifest.chains)) {
        for (const chain of manifest.chains) {
          const post = chain.raw?.post || {};
          const attachments = (post.attachments || []).filter((a) => !a.tags || a.tags.includes('sora'));
          for (const attachment of attachments) indexMeta(metaFromChain(chain, attachment), byId, byStem, byAuthorDate, byAuthor);
        }
      } else {
        stats.unknownJson++;
      }
    } catch (e) {
      stats.errors++;
    }
    if (parsed % 10 === 0) await yieldToServer();
  }
  onProgress({ ...stats, phase: 'metadata_ready', currentFile: '' });
  return { byId, byStem, byAuthorDate, byAuthor };
}

function indexMeta(meta, byId, byStem, byAuthorDate, byAuthor) {
  for (const id of [meta.generation_id, meta.task_id, meta.post_id, meta.attachment_id, meta.parent_post_id, meta.parent_generation_id]) addKey(byId, id, meta);
  addIndex(byStem, buildBasename(meta.date, meta.generation_id || meta.attachment_id || meta.post_id, meta.prompt), meta);
  addIndex(byStem, buildBasename(meta.date, meta.attachment_id || meta.generation_id || meta.post_id, meta.prompt), meta);
  addIndex(byStem, `${meta.date || ''}_${meta.author || ''}_${meta.prompt || ''}`, meta);
  const a = authorKey(meta.author);
  const d = dateKey(meta.date);
  if (a && d) addGroup(byAuthorDate, `${a}|${d}`, meta);
  if (a) addGroup(byAuthor, a, meta);
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function isWeakFallbackPrompt(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  if (/^attachment\s*[-_]?\s*\d+$/.test(text)) return true;
  if (/^(no prompt|no_prompt|unknown|untitled|video|download)$/.test(text)) return true;
  return false;
}

function mergeMeta(base, next) {
  if (!next) return base;
  const out = { ...base };
  const nextPriority = Number(next._priority || 0);
  const outPriority = Number(out._priority || 0);
  const fields = ['generation_id','task_id','post_id','parent_post_id','root_post_id','parent_generation_id','parent_task_id','author','date','duration_s','width','height','aspect_ratio','liked','like_count','view_count','remix_count','reply_count','share_count','prompt','source','metadata_source'];
  for (const f of fields) {
    if (!hasValue(next[f])) continue;
    const currentMissing = !hasValue(out[f]);
    const strongerSource = nextPriority > outPriority;
    if (f === 'prompt') {
      if (currentMissing || isWeakFallbackPrompt(out[f]) || strongerSource) out[f] = next[f];
    } else if (currentMissing || strongerSource) {
      out[f] = next[f];
    }
  }
  out._priority = Math.max(outPriority, nextPriority);
  out._cameos = [...new Set([...(out._cameos || []), ...(next._cameos || [])])];
  out._profiles = [...(out._profiles || []), ...(next._profiles || [])];
  out._characterProfiles = [...(out._characterProfiles || []), ...(next._characterProfiles || [])];
  return out;
}


async function upsertCreatorProfiles(db, profiles = []) {
  const seen = new Set();
  const now = new Date().toISOString();
  for (const profile of profiles || []) {
    if (!profile?.username || seen.has(profile.username)) continue;
    seen.add(profile.username);
    const verified = profile.verified == null ? null : (profile.verified ? 1 : 0);
    const isPublicFigure = profile.is_public_figure == null ? null : (profile.is_public_figure ? 1 : 0);
    if (db.engine === 'duckdb') {
      // DuckDB path uses DELETE + INSERT; preserve avatar_ext (set by the
      // avatar phase, not present in the source extracted.json) by reading
      // it before the delete and re-inserting it.
      const existing = await db.get('SELECT avatar_ext FROM creator_profiles WHERE username = ?', [profile.username]);
      const preservedExt = existing?.avatar_ext || null;
      await db.run(`DELETE FROM creator_profiles WHERE username = ?`, [profile.username]);
      await db.run(`INSERT INTO creator_profiles
        (username, display_name, description, follower_count, following_count, post_count, reply_count, likes_received_count, remix_count, cameo_count, character_count, raw_json, user_id, verified, is_public_figure, permalink, first_seen_at, avatar_ext)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          profile.username, profile.display_name, profile.description,
          profile.follower_count, profile.following_count, profile.post_count, profile.reply_count,
          profile.likes_received_count, profile.remix_count, profile.cameo_count, profile.character_count,
          profile.raw_json,
          profile.user_id || null, verified, isPublicFigure, profile.permalink || null, now,
          preservedExt
        ]);
    } else {
      await db.run(`INSERT INTO creator_profiles
        (username, display_name, description, follower_count, following_count, post_count, reply_count, likes_received_count, remix_count, cameo_count, character_count, raw_json, user_id, verified, is_public_figure, permalink, first_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
          display_name=COALESCE(excluded.display_name, creator_profiles.display_name),
          description=COALESCE(excluded.description, creator_profiles.description),
          follower_count=COALESCE(excluded.follower_count, creator_profiles.follower_count),
          following_count=COALESCE(excluded.following_count, creator_profiles.following_count),
          post_count=COALESCE(excluded.post_count, creator_profiles.post_count),
          reply_count=COALESCE(excluded.reply_count, creator_profiles.reply_count),
          likes_received_count=COALESCE(excluded.likes_received_count, creator_profiles.likes_received_count),
          remix_count=COALESCE(excluded.remix_count, creator_profiles.remix_count),
          cameo_count=COALESCE(excluded.cameo_count, creator_profiles.cameo_count),
          character_count=COALESCE(excluded.character_count, creator_profiles.character_count),
          raw_json=COALESCE(excluded.raw_json, creator_profiles.raw_json),
          user_id=COALESCE(excluded.user_id, creator_profiles.user_id),
          verified=COALESCE(excluded.verified, creator_profiles.verified),
          is_public_figure=COALESCE(excluded.is_public_figure, creator_profiles.is_public_figure),
          permalink=COALESCE(excluded.permalink, creator_profiles.permalink),
          first_seen_at=COALESCE(creator_profiles.first_seen_at, excluded.first_seen_at)`, [
            profile.username, profile.display_name, profile.description,
            profile.follower_count, profile.following_count, profile.post_count, profile.reply_count,
            profile.likes_received_count, profile.remix_count, profile.cameo_count, profile.character_count,
            profile.raw_json,
            profile.user_id || null, verified, isPublicFigure, profile.permalink || null, now
          ]);
    }
  }
}

async function upsertCharacterProfiles(db, characters = []) {
  const seen = new Set();
  const ownerProfiles = [];
  for (const character of characters || []) {
    if (!character?.character_name || seen.has(character.character_name)) continue;
    seen.add(character.character_name);
    if (character._ownerProfile) ownerProfiles.push(character._ownerProfile);
    if (db.engine === 'duckdb') {
      await db.run(`DELETE FROM character_profiles WHERE character_name = ?`, [character.character_name]);
      await db.run(`INSERT INTO character_profiles
        (character_name, display_name, owner_username, description, likes_received_count, remix_count, cameo_count, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [character.character_name, character.display_name, character.owner_username, character.description, character.likes_received_count, character.remix_count, character.cameo_count, character.raw_json]);
    } else {
      await db.run(`INSERT INTO character_profiles
        (character_name, display_name, owner_username, description, likes_received_count, remix_count, cameo_count, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(character_name) DO UPDATE SET
          display_name=COALESCE(excluded.display_name, character_profiles.display_name),
          owner_username=COALESCE(excluded.owner_username, character_profiles.owner_username),
          description=COALESCE(excluded.description, character_profiles.description),
          likes_received_count=COALESCE(excluded.likes_received_count, character_profiles.likes_received_count),
          remix_count=COALESCE(excluded.remix_count, character_profiles.remix_count),
          cameo_count=COALESCE(excluded.cameo_count, character_profiles.cameo_count),
          raw_json=COALESCE(excluded.raw_json, character_profiles.raw_json)`, [character.character_name, character.display_name, character.owner_username, character.description, character.likes_received_count, character.remix_count, character.cameo_count, character.raw_json]);
    }
  }
  if (ownerProfiles.length) await upsertCreatorProfiles(db, ownerProfiles);
}

function bestMatchForVideo(filename, indexes, relPath = '') {
  const ids = extractIdsFromName(filename);
  for (const id of [ids.generation_id, ids.task_id, ids.post_id]) {
    const rows = indexes.byId.get(String(id || '').toLowerCase());
    if (rows?.length) return rows.sort((a,b)=>(b._priority||0)-(a._priority||0))[0];
  }
  const stem = normalizeStem(filename);
  const title = humanizeStem(filename);
  const candidates = [stem, normalizeStem(stem.replace(/^\d{4}_\d{2}_\d{2}_/, ''))];
  for (const c of candidates) {
    const rows = indexes.byStem.get(c);
    if (rows?.length) return rows.sort((a,b)=>(b._priority||0)-(a._priority||0))[0];
  }

  // Many basic archives have filenames without usable gen/post IDs. In that
  // case, try a conservative author+date+title match against manifest rows.
  // This is what lets public counts appear when the manifest is present but the
  // downloaded file was renamed or deduped.
  const a = authorKey(authorFromPath(relPath));
  const d = dateKey(ids.date || filename.match(/\d{4}-\d{2}-\d{2}/)?.[0]);
  if (a && d) {
    const match = chooseBestByTitle(indexes.byAuthorDate?.get(`${a}|${d}`) || [], title);
    if (match) return match;
  }
  if (a) {
    const match = chooseBestByTitle(indexes.byAuthor?.get(a) || [], title);
    if (match) return match;
  }
  return null;
}

function makeInitialStats(archivePath, dbPath, dbEngine, manifestMode) {
  return { archivePath, dbPath, dbEngine, manifestMode, found: 0, inserted: 0, skipped: 0, cameosInserted: 0, noTxt: 0, errors: 0, processed: 0, manifestsFound: 0, unknownJson: 0, thumbnailsFound: 0, previewsFound: 0, commentFilesFound: 0, commentsInserted: 0, commentProfilesUpserted: 0, avatarsDownloaded: 0, avatarsSkipped: 0, avatarsFailed: 0, currentFile: '', startedAt: new Date().toISOString(), completedAt: null };
}

function profileFromExtractedAuthor(node, raw_json = null) {
  if (!node || !node.username) return null;
  return {
    user_id: node.user_id || null,
    username: node.username,
    display_name: node.display_name || null,
    description: node.description || null,
    follower_count: node.follower_count ?? null,
    following_count: node.following_count ?? null,
    post_count: node.post_count ?? null,
    reply_count: node.reply_count ?? null,
    likes_received_count: node.likes_received_count ?? null,
    remix_count: node.remix_count ?? null,
    cameo_count: node.cameo_count ?? null,
    character_count: node.character_count ?? null,
    verified: node.verified == null ? null : (node.verified ? 1 : 0),
    is_public_figure: node.is_public_figure == null ? null : (node.is_public_figure ? 1 : 0),
    permalink: node.permalink || null,
    profile_picture_url: node.profile_picture_url || null,
    raw_json,
  };
}

function flattenCommentsFromExtracted(payload) {
  const comments = [];
  const profiles = new Map();
  const posts = Array.isArray(payload?.posts) ? payload.posts : [];

  for (const post of posts) {
    const nested = Array.isArray(post?.comments) ? post.comments : [];
    for (const c of nested) {
      if (!c?.comment_id) continue;
      comments.push({
        comment_id: String(c.comment_id),
        parent_post_id: c.parent_post_id || post.post_id || null,
        root_post_id: c.root_post_id || post.root_post_id || null,
        author_username: c.author?.username || null,
        author_user_id: c.author?.user_id || null,
        text: c.text ?? null,
        posted_at: c.posted_at || null,
        updated_at: c.updated_at || null,
        tombstoned_at: c.tombstoned_at || null,
        like_count: c.like_count ?? null,
        dislike_count: c.dislike_count ?? null,
        reply_count: c.reply_count ?? null,
        recursive_reply_count: c.recursive_reply_count ?? null,
        view_count: c.view_count ?? null,
        remix_count: c.remix_count ?? null,
        permalink: c.permalink || null,
        source: c.source || null,
        attachments_json: Array.isArray(c.video_attachments) && c.video_attachments.length
          ? JSON.stringify(c.video_attachments)
          : null,
      });
      const cp = profileFromExtractedAuthor(c.author);
      if (cp && !profiles.has(cp.username)) profiles.set(cp.username, cp);
    }
  }

  // The all_profiles[] block is the canonical author registry — pick up post
  // authors and any profiles not seen in the comments themselves.
  const all = Array.isArray(payload?.all_profiles) ? payload.all_profiles : [];
  for (const p of all) {
    const profile = profileFromExtractedAuthor(p);
    if (profile && !profiles.has(profile.username)) profiles.set(profile.username, profile);
  }

  return { comments, profiles: Array.from(profiles.values()) };
}

async function* walkExtractedJson(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      // Skip the profiles dir and node_modules, but otherwise recurse.
      if (entry.name === 'profiles' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walkExtractedJson(full);
    } else if (entry.isFile() && /\.extracted\.json$/i.test(entry.name)) {
      yield full;
    }
  }
}

export async function ingestCommentsFromDir({ commentsDir, vaultRoot, dbPath, dbEngine = 'sqlite', onProgress = () => {}, signal = null, downloadAvatars = false, debugAvatars = false } = {}) {
  if (!commentsDir) throw new Error('commentsDir is required.');
  if (!dbPath) throw new Error('dbPath is required.');
  const resolvedRoot = path.resolve(commentsDir);
  const resolvedDbPath = path.resolve(dbPath);
  const resolvedVault = path.resolve(vaultRoot || commentsDir);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    throw new Error(`Comments path is not a directory: ${resolvedRoot}`);
  }

  const db = await openWriteClient(resolvedDbPath, dbEngine);
  await createSchema(db);

  const stats = {
    phase: 'scanning_comments',
    commentFilesFound: 0,
    filesProcessed: 0,
    commentsInserted: 0,
    profilesUpserted: 0,
    avatarsDownloaded: 0,
    avatarsSkipped: 0,
    avatarsFailed: 0,
    errors: 0,
    currentFile: '',
  };
  function emit(extra = {}) { onProgress({ ...stats, ...extra }); }

  emit({ phase: 'scanning_comments' });
  const files = [];
  for await (const filePath of walkExtractedJson(resolvedRoot)) {
    if (signal?.aborted) throw new Error('Comment ingest canceled.');
    files.push(filePath);
  }
  stats.commentFilesFound = files.length;
  emit({ phase: 'parsing_comments' });

  // Pre-aggregate profiles across all files so we can run a single bounded
  // download pool at the end. Comments are inserted file-by-file so progress
  // is visible and partial failures don't lose earlier files' work.
  const profileMap = new Map();

  const insertSql = db.engine === 'duckdb'
    ? `INSERT INTO comments
       (comment_id, parent_post_id, root_post_id, author_username, author_user_id, text, posted_at, updated_at, tombstoned_at, like_count, dislike_count, reply_count, recursive_reply_count, view_count, remix_count, permalink, source, attachments_json, source_file, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
    : `INSERT OR IGNORE INTO comments
       (comment_id, parent_post_id, root_post_id, author_username, author_user_id, text, posted_at, updated_at, tombstoned_at, like_count, dislike_count, reply_count, recursive_reply_count, view_count, remix_count, permalink, source, attachments_json, source_file, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  try {
    for (const filePath of files) {
      if (signal?.aborted) throw new Error('Comment ingest canceled.');
      stats.currentFile = path.relative(resolvedRoot, filePath);
      try {
        const text = fs.readFileSync(filePath, 'utf8');
        const payload = JSON.parse(text);
        const sourceFile = path.basename(filePath);
        const { comments, profiles } = flattenCommentsFromExtracted(payload);

        for (const profile of profiles) {
          if (!profileMap.has(profile.username)) profileMap.set(profile.username, profile);
        }

        await upsertCreatorProfiles(db, profiles);
        stats.profilesUpserted += profiles.length;

        const now = new Date().toISOString();
        for (const c of comments) {
          if (!c.parent_post_id) continue;
          const r = await db.run(insertSql, [
            c.comment_id, c.parent_post_id, c.root_post_id, c.author_username, c.author_user_id,
            c.text, c.posted_at, c.updated_at, c.tombstoned_at,
            c.like_count, c.dislike_count, c.reply_count, c.recursive_reply_count, c.view_count, c.remix_count,
            c.permalink, c.source, c.attachments_json, sourceFile, now,
          ]);
          if (r?.changes) stats.commentsInserted++;
        }
        stats.filesProcessed++;
        if (stats.filesProcessed % 5 === 0) emit({ phase: 'parsing_comments' });
      } catch (e) {
        stats.errors++;
        emit({ phase: 'error', message: `${filePath}: ${e.message}` });
      }
    }

    if (downloadAvatars && profileMap.size > 0) {
      stats.phase = 'downloading_avatars';
      emit({ phase: 'downloading_avatars' });
      const { ensureAvatarsBatch, recordAvatarExt } = await import('./profile-fetch.js');
      const result = await ensureAvatarsBatch(resolvedVault, Array.from(profileMap.values()), {
        concurrency: 6,
        onAttempt: debugAvatars
          ? ({ username, url }) => emit({ phase: 'avatar_attempt', message: `→ ${username}\n   ${url}` })
          : null,
        onError: ({ username, error, url, status }) => {
          const head = status ? `HTTP ${status}` : (error?.message || String(error));
          emit({ phase: 'warning', message: `avatar ${username}: ${head}\n   URL: ${url || '(no url)'}` });
        },
        onResult: async ({ username, status, filePath, url }) => {
          if (status === 'downloaded') {
            stats.avatarsDownloaded++;
            if (debugAvatars) emit({ phase: 'avatar_ok', message: `✓ ${username} ${url ? `← ${url}` : ''}` });
          } else if (status === 'skipped') stats.avatarsSkipped++;
          if ((status === 'downloaded' || status === 'skipped') && filePath) {
            const ext = path.extname(filePath).slice(1).toLowerCase();
            if (ext) await recordAvatarExt(db, username, ext);
          }
        },
      });
      stats.avatarsFailed = result.failed;
    }

    // Reconcile any rows untouched by the batch (older imports, manual
    // download-profiles.js runs) so the DB is the single source of truth.
    stats.phase = 'reconciling_avatars';
    emit({ phase: 'reconciling_avatars' });
    try {
      const { reconcileAvatarRegistry } = await import('./profile-fetch.js');
      const recon = await reconcileAvatarRegistry(db, resolvedVault);
      stats.avatarsRegistered = recon.set + recon.unchanged;
      stats.avatarsCleared = recon.cleared;
    } catch (e) {
      emit({ phase: 'warning', message: `Reconcile avatar registry: ${e.message}` });
    }

    // Denormalize comment counts onto videos.
    stats.phase = 'refreshing_video_comment_counts';
    emit({ phase: 'refreshing_video_comment_counts' });
    try {
      await db.run(`
        UPDATE videos SET comment_count = COALESCE((
          SELECT COUNT(*) FROM comments c WHERE c.parent_post_id = videos.post_id
        ), 0)
        WHERE post_id IS NOT NULL AND post_id != ''
      `);
    } catch (e) {
      emit({ phase: 'warning', message: `Refresh video comment_count: ${e.message}` });
    }

    stats.phase = 'comments_complete';
    stats.completedAt = new Date().toISOString();
    emit({ phase: 'comments_complete' });
    return stats;
  } finally {
    await db.close?.();
  }
}

export async function analyzePromptCharacterMentions({ dbPath, dbEngine = 'sqlite', onProgress = () => {} } = {}) {
  if (!dbPath) throw new Error('dbPath is required.');
  const resolvedDbPath = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDbPath)) throw new Error(`Database not found: ${resolvedDbPath}`);

  const db = await openWriteClient(resolvedDbPath, dbEngine);
  await createSchema(db);

  const insertCameoSql = db.engine === 'duckdb'
    ? `INSERT INTO cameos (video_id, character_name) VALUES (?, ?) ON CONFLICT DO NOTHING`
    : `INSERT OR IGNORE INTO cameos (video_id, character_name) VALUES (?, ?)`;

  const stats = { scanned: 0, videosWithMentions: 0, uniqueMentions: 0, linksAttempted: 0, linksInserted: 0, errors: 0, phase: 'starting' };
  const allMentions = new Set();

  try {
    const rows = await db.all(`SELECT id, prompt FROM videos WHERE prompt IS NOT NULL AND prompt != '' ORDER BY id`);
    stats.phase = 'analyzing';
    stats.total = rows.length;
    onProgress({ ...stats });

    for (const row of rows) {
      stats.scanned++;
      const mentions = extractCameos(row.prompt);
      if (mentions.length) stats.videosWithMentions++;
      for (const mention of mentions) {
        allMentions.add(mention);
        stats.linksAttempted++;
        try {
          const result = await db.run(insertCameoSql, [row.id, mention]);
          if (Number(result?.changes || 0) > 0) stats.linksInserted++;
        } catch {
          stats.errors++;
        }
      }
      if (stats.scanned % 500 === 0) {
        stats.uniqueMentions = allMentions.size;
        onProgress({ ...stats });
        await yieldToServer();
      }
    }

    stats.uniqueMentions = allMentions.size;
    stats.phase = 'complete';
    onProgress({ ...stats });
    return stats;
  } finally {
    await db.close?.();
  }
}

export async function ingestSoraArchive({ archivePath, dbPath, dbEngine = 'sqlite', manifestMode = 'unknown', commentsDir = null, downloadAvatars = false, debugAvatars = false, onProgress = () => {}, signal = null } = {}) {
  if (!archivePath) throw new Error('archivePath is required.');
  if (!dbPath) throw new Error('dbPath is required.');
  const rootDir = path.resolve(archivePath);
  const resolvedDbPath = path.resolve(dbPath);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) throw new Error(`Archive path is not a directory: ${rootDir}`);
  await mkdir(path.dirname(resolvedDbPath), { recursive: true });

  const stats = makeInitialStats(rootDir, resolvedDbPath, normalizeDbEngine(dbEngine), manifestMode);
  const db = await openWriteClient(resolvedDbPath, dbEngine);
  await createSchema(db);

  function emitProgress(extra = {}) { onProgress({ ...stats, ...extra }); }
  emitProgress({ phase: 'scanning' });

  const videoFiles = [];
  const jsonFiles = [];
  let scannedFiles = 0;
  for await (const filePath of walk(rootDir)) {
    if (signal?.aborted) throw new Error('Ingest canceled.');
    scannedFiles++;
    const ext = path.extname(filePath).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) {
      videoFiles.push(filePath);
      stats.found = videoFiles.length;
    } else if (ext === '.json') {
      jsonFiles.push(filePath);
    }
    if (scannedFiles % 250 === 0) {
      stats.currentFile = path.relative(rootDir, filePath);
      emitProgress({ phase: 'scanning' });
      await yieldToServer();
    }
  }

  emitProgress({ phase: 'parsing_metadata', currentFile: '' });
  const indexes = await buildMetadataIndexes(jsonFiles, stats, onProgress, rootDir);

  const insertSql = `INSERT INTO videos
    (file_path, file_size, filename, generation_id, task_id, post_id, parent_post_id, root_post_id, parent_generation_id, parent_task_id,
     author, date, duration_s, width, height, aspect_ratio, liked, like_count, view_count, remix_count, reply_count, share_count,
     prompt, source, source_dir, thumbnail_path, preview_path, metadata_source, has_txt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const updateSql = `UPDATE videos SET file_size=?, filename=?, generation_id=?, task_id=?, post_id=?, parent_post_id=?, root_post_id=?, parent_generation_id=?, parent_task_id=?,
    author=?, date=?, duration_s=?, width=?, height=?, aspect_ratio=?, liked=?, like_count=?, view_count=?, remix_count=?, reply_count=?, share_count=?, prompt=?, source=?, source_dir=?, thumbnail_path=?, preview_path=?, metadata_source=?, has_txt=?, ingested_at=${db.engine === 'duckdb' ? 'current_timestamp' : "datetime('now')"}
    WHERE file_path=?`;
  const insertCameoSql = db.engine === 'duckdb'
    ? `INSERT INTO cameos (video_id, character_name) VALUES (?, ?) ON CONFLICT DO NOTHING`
    : `INSERT OR IGNORE INTO cameos (video_id, character_name) VALUES (?, ?)`;

  try {
    for (const filePath of videoFiles) {
      if (signal?.aborted) throw new Error('Ingest canceled.');
      stats.processed++; stats.currentFile = path.relative(rootDir, filePath);
      try {
        const relPath = path.relative(rootDir, filePath);
        const filename = path.basename(filePath);
        const st = fs.statSync(filePath);
        const ids = extractIdsFromName(filename);
        let meta = {
          ...ids,
          author: authorFromPath(relPath),
          prompt: humanizeStem(filename) || null,
          source_dir: sourceDir(relPath),
          source: null,
          metadata_source: 'filename_path',
          _cameos: [],
          _priority: 10,
        };
        let hasTxt = 0;
        const txtPath = companionTextPath(filePath);
        if (fs.existsSync(txtPath)) { meta = mergeMeta(meta, parseTxt(txtPath)); hasTxt = 1; } else stats.noTxt++;
        meta = mergeMeta(meta, bestMatchForVideo(filename, indexes, relPath));
        const thumb = findLocalAsset(filePath, 'thumb');
        const preview = findLocalAsset(filePath, 'preview');
        if (thumb) stats.thumbnailsFound++;
        if (preview) stats.previewsFound++;
        const row = [
          relPath, st.size, filename, meta.generation_id || null, meta.task_id || null, meta.post_id || null,
          meta.parent_post_id || null, meta.root_post_id || null, meta.parent_generation_id || null, meta.parent_task_id || null,
          meta.author || null, meta.date || null, meta.duration_s ?? null, meta.width ?? null, meta.height ?? null,
          meta.aspect_ratio || aspectRatio(meta.width, meta.height), meta.liked ?? null,
          meta.like_count ?? null, meta.view_count ?? null, meta.remix_count ?? null, meta.reply_count ?? null, meta.share_count ?? null,
          meta.prompt || null, meta.source || null,
          meta.source_dir || sourceDir(relPath), thumb ? path.relative(rootDir, thumb) : null, preview ? path.relative(rootDir, preview) : null,
          meta.metadata_source || 'filename_path', hasTxt
        ];
        const existing = await db.get('SELECT id FROM videos WHERE file_path = ?', [relPath]);
        let videoId;
        if (existing) {
          await db.run(updateSql, [...row.slice(1), relPath]);
          videoId = existing.id;
          stats.skipped++;
        } else {
          await db.run(insertSql, row);
          const inserted = await db.get('SELECT id FROM videos WHERE file_path = ?', [relPath]);
          videoId = inserted?.id;
          stats.inserted++;
        }
        const cameos = [...new Set([...(meta._cameos || []), ...extractCameos(meta.prompt)])].map((x) => String(x).toLowerCase()).filter(Boolean);
        for (const cameo of cameos) {
          try { await db.run(insertCameoSql, [videoId, cameo]); stats.cameosInserted++; } catch {}
        }
        try {
          await upsertCreatorProfiles(db, meta._profiles || []);
          await upsertCharacterProfiles(db, meta._characterProfiles || []);
        } catch {}
        if (stats.processed % 25 === 0) emitProgress({ phase: 'ingesting' });
        if (stats.processed % 50 === 0) await yieldToServer();
      } catch (e) {
        stats.errors++;
        emitProgress({ phase: 'error', message: `${filePath}: ${e.message}` });
      }
    }

    const resolvedCommentsDir = commentsDir ? path.resolve(commentsDir) : rootDir;
    if (resolvedCommentsDir && fs.existsSync(resolvedCommentsDir)) {
      try {
        emitProgress({ phase: 'parsing_comments', currentFile: '' });
        const commentStats = await runCommentsPhase(db, resolvedCommentsDir, rootDir, downloadAvatars, debugAvatars, signal, (extra) => emitProgress(extra));
        stats.commentFilesFound = commentStats.commentFilesFound;
        stats.commentsInserted = commentStats.commentsInserted;
        stats.commentProfilesUpserted = commentStats.profilesUpserted;
        stats.avatarsDownloaded = commentStats.avatarsDownloaded;
        stats.avatarsSkipped = commentStats.avatarsSkipped;
        stats.avatarsFailed = commentStats.avatarsFailed;
      } catch (e) {
        emitProgress({ phase: 'warning', message: `Comments phase: ${e.message}` });
      }
    }

    stats.completedAt = new Date().toISOString();
    emitProgress({ phase: 'complete' });
    return stats;
  } finally {
    await db.close?.();
  }
}

async function runCommentsPhase(db, commentsDir, vaultRoot, downloadAvatars, debugAvatars, signal, emit) {
  const stats = {
    commentFilesFound: 0,
    filesProcessed: 0,
    commentsInserted: 0,
    profilesUpserted: 0,
    avatarsDownloaded: 0,
    avatarsSkipped: 0,
    avatarsFailed: 0,
  };

  const files = [];
  for await (const filePath of walkExtractedJson(commentsDir)) {
    if (signal?.aborted) throw new Error('Ingest canceled.');
    files.push(filePath);
  }
  stats.commentFilesFound = files.length;
  if (!files.length) return stats;

  const insertSql = db.engine === 'duckdb'
    ? `INSERT INTO comments
       (comment_id, parent_post_id, root_post_id, author_username, author_user_id, text, posted_at, updated_at, tombstoned_at, like_count, dislike_count, reply_count, recursive_reply_count, view_count, remix_count, permalink, source, attachments_json, source_file, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
    : `INSERT OR IGNORE INTO comments
       (comment_id, parent_post_id, root_post_id, author_username, author_user_id, text, posted_at, updated_at, tombstoned_at, like_count, dislike_count, reply_count, recursive_reply_count, view_count, remix_count, permalink, source, attachments_json, source_file, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const profileMap = new Map();

  for (const filePath of files) {
    if (signal?.aborted) throw new Error('Ingest canceled.');
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const payload = JSON.parse(text);
      const sourceFile = path.basename(filePath);
      const { comments, profiles } = flattenCommentsFromExtracted(payload);

      for (const profile of profiles) {
        if (!profileMap.has(profile.username)) profileMap.set(profile.username, profile);
      }
      await upsertCreatorProfiles(db, profiles);
      stats.profilesUpserted += profiles.length;

      const now = new Date().toISOString();
      for (const c of comments) {
        if (!c.parent_post_id) continue;
        await db.run(insertSql, [
          c.comment_id, c.parent_post_id, c.root_post_id, c.author_username, c.author_user_id,
          c.text, c.posted_at, c.updated_at, c.tombstoned_at,
          c.like_count, c.dislike_count, c.reply_count, c.recursive_reply_count, c.view_count, c.remix_count,
          c.permalink, c.source, c.attachments_json, sourceFile, now,
        ]);
        stats.commentsInserted++;
      }
      stats.filesProcessed++;
      if (stats.filesProcessed % 5 === 0) emit({ phase: 'parsing_comments', currentFile: path.relative(commentsDir, filePath) });
    } catch (e) {
      emit({ phase: 'warning', message: `${filePath}: ${e.message}` });
    }
  }

  if (downloadAvatars && profileMap.size > 0) {
    emit({ phase: 'downloading_avatars', currentFile: '' });
    const { ensureAvatarsBatch, recordAvatarExt } = await import('./profile-fetch.js');
    const result = await ensureAvatarsBatch(vaultRoot, Array.from(profileMap.values()), {
      concurrency: 6,
      onAttempt: debugAvatars
        ? ({ username, url }) => emit({ phase: 'avatar_attempt', message: `→ ${username}\n   ${url}` })
        : null,
      onError: ({ username, error, url, status }) => {
        const head = status ? `HTTP ${status}` : (error?.message || String(error));
        emit({ phase: 'warning', message: `avatar ${username}: ${head}\n   URL: ${url || '(no url)'}` });
      },
      onResult: async ({ username, status, filePath, url }) => {
        if (status === 'downloaded') {
          stats.avatarsDownloaded++;
          if (debugAvatars) emit({ phase: 'avatar_ok', message: `✓ ${username} ${url ? `← ${url}` : ''}` });
        } else if (status === 'skipped') stats.avatarsSkipped++;
        if ((status === 'downloaded' || status === 'skipped') && filePath) {
          const ext = path.extname(filePath).slice(1).toLowerCase();
          if (ext) await recordAvatarExt(db, username, ext);
        }
      },
    });
    stats.avatarsFailed = result.failed;
  }

  // Reconcile avatar_ext for any creator_profiles rows that weren't touched
  // by this run's avatar batch (e.g. older imports, or avatars dropped on
  // disk by download-profiles.js). One pass writes findings to the DB so
  // the Server panel can answer coverage questions without an FS scan.
  emit({ phase: 'reconciling_avatars', currentFile: '' });
  try {
    const { reconcileAvatarRegistry } = await import('./profile-fetch.js');
    const recon = await reconcileAvatarRegistry(db, vaultRoot);
    stats.avatarsRegistered = recon.set + recon.unchanged;
    stats.avatarsCleared = recon.cleared;
  } catch (e) {
    emit({ phase: 'warning', message: `Reconcile avatar registry: ${e.message}` });
  }

  // Denormalize comment counts onto videos so summary tables and
  // "most-commented" listings don't need a join. Single set-based UPDATE
  // keyed on the indexed post_id columns.
  emit({ phase: 'refreshing_video_comment_counts', currentFile: '' });
  try {
    await db.run(`
      UPDATE videos SET comment_count = COALESCE((
        SELECT COUNT(*) FROM comments c WHERE c.parent_post_id = videos.post_id
      ), 0)
      WHERE post_id IS NOT NULL AND post_id != ''
    `);
  } catch (e) {
    emit({ phase: 'warning', message: `Refresh video comment_count: ${e.message}` });
  }

  return stats;
}
