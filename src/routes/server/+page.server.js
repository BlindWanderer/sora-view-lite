import { fail, redirect } from '@sveltejs/kit';
import { closeDB, getAssetHealth, getStats, getCommentStats, getProfileStats, getAvatarStats, getMostCommentedVideos, getDuplicateCandidates, getTimelineStats, rebuildPersonSummaries as rebuildSummaries, optimizeDatabase as optimizeDb, getDB } from '$lib/db.js';
import { defaultDbPathForArchive, getConfig, normalizeDbEngine, updateConfig } from '$lib/config.js';
import { getIngestJob, startIngestJob } from '$lib/server/ingest-job.js';
import { analyzePromptCharacterMentions } from '$lib/server/ingest.js';
import { cancelAssetJob as requestAssetJobCancel, getAssetJob, startAssetJob } from '$lib/server/asset-job.js';
import { cancelAvatarJob as requestAvatarJobCancel, getAvatarJob, startAvatarJob } from '$lib/server/avatar-job.js';
import { reconcileAvatarRegistry } from '$lib/server/profile-fetch.js';
import { applyMetadataImport, validateImportPayload } from '$lib/server/metadata-import.js';
import {
  cancelRefreshJob as requestRefreshJobCancel,
  getRefreshJob,
  getRefreshInventory,
  getPlaywrightStatus,
  getLastRefreshRun,
  startExtractPermalinks,
  startDedupeLinks,
  startFetchHtml,
  startExtractHtml,
  startAssetDownload,
  startRunAll,
} from '$lib/server/refresh-job.js';
import {
  getBookmarkJob,
  startBookmarkJob,
  cancelBookmarkJob as requestBookmarkJobCancel,
  clearBookmarkJob,
  setBookmarkLookupOnly,
  extractPostIdFromUrl,
  lookupBookmarkInDb,
} from '$lib/server/bookmark-job.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import QRCode from 'qrcode';


function checkFfmpeg() {
  const local = path.resolve(process.cwd(), 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(local)) return { found: true, path: local };
  const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  return { found: result.status === 0, path: result.status === 0 ? 'PATH' : '' };
}

// Tracks which serverAccessMode the running process actually bound at startup,
// so the UI can detect a config-vs-runtime mismatch and tell the user to restart.
const RUNTIME_ACCESS_MODE = (() => {
  const cfg = getConfig();
  return cfg?.serverAccessMode || 'local';
})();

/**
 * Enumerate IPv4 addresses bound to non-loopback interfaces. Returns an array
 * of `{ name, address }` for each candidate. Used to render LAN connect URLs
 * for phones / other computers on the same network.
 */
function detectLanInterfaces() {
  const out = [];
  let nets;
  try { nets = os.networkInterfaces(); } catch { return out; }
  for (const [name, ifaces] of Object.entries(nets || {})) {
    for (const iface of ifaces || []) {
      if (!iface || iface.internal) continue;
      // Node 18+ may use `family: 'IPv4'` (string) or 4 (number)
      const family = iface.family;
      if (family !== 'IPv4' && family !== 4) continue;
      out.push({ name, address: iface.address });
    }
  }
  return out;
}

async function buildAccessNetwork(config) {
  const port = Number(config?.appPort) || 5173;
  const interfaces = detectLanInterfaces();
  const localUrl = `http://127.0.0.1:${port}`;
  const lanEntries = await Promise.all(interfaces.map(async (iface) => {
    const url = `http://${iface.address}:${port}`;
    let qrSvg = '';
    try { qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 180 }); }
    catch { qrSvg = ''; }
    return { ...iface, url, qrSvg };
  }));
  let localQr = '';
  try { localQr = await QRCode.toString(localUrl, { type: 'svg', margin: 1, width: 180 }); } catch {}
  return {
    port,
    runtimeMode: RUNTIME_ACCESS_MODE,
    configuredMode: config?.serverAccessMode || 'local',
    needsRestart: (config?.serverAccessMode || 'local') !== RUNTIME_ACCESS_MODE,
    localUrl,
    localQr,
    lan: lanEntries,
  };
}

export async function load({ url }) {
  const config = getConfig();
  if (!config) throw redirect(302, '/setup');

  let assetHealth = null;
  let archiveStats = null;
  let commentStats = null;
  let profileStats = null;
  let avatarStats = null;
  let mostCommented = [];
  let assetError = null;
  let duplicates = [];
  let timeline = [];
  const diagnostics = { node: process.version, platform: process.platform, cwd: process.cwd(), ffmpeg: checkFfmpeg() };
  const network = await buildAccessNetwork(config);
  try {
    assetHealth = await getAssetHealth();
    archiveStats = await getStats();
    commentStats = await getCommentStats();
    profileStats = await getProfileStats();
    avatarStats = await getAvatarStats();
    mostCommented = await getMostCommentedVideos({ pageSize: 10 });
    duplicates = await getDuplicateCandidates({ limit: 8 });
    timeline = await getTimelineStats();
  } catch (e) {
    assetError = e.message;
  }

  const allowedTabs = new Set(['overview','import','assets','library','display','data','access','about']);
  const tab = allowedTabs.has(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'overview';

  return {
    tab,
    config,
    assetHealth,
    archiveStats,
    commentStats,
    profileStats,
    avatarStats,
    mostCommented,
    assetError,
    job: getIngestJob(),
    assetJob: getAssetJob(),
    avatarJob: getAvatarJob(),
    refreshJob: getRefreshJob(),
    refreshInventory: getRefreshInventory(),
    refreshLastRun: getLastRefreshRun(),
    bookmarkJob: getBookmarkJob(),
    // Skip the chromium probe on the import tab so we don't pay the launch cost
    // every time someone opens an unrelated tab. The Assets tab probes anyway.
    playwrightStatus: tab === 'assets'
      ? await getPlaywrightStatus({ probeBrowser: true }).catch((e) => ({ ok: false, reason: 'load-error', error: e.message }))
      : null,
    duplicates,
    timeline: timeline.slice(0, 12),
    diagnostics,
    network,
  };
}

export const actions = {
  rescan: async () => {
    const config = getConfig();
    if (!config) throw redirect(303, '/setup');
    await closeDB();
    startIngestJob(config);
    throw redirect(303, '/setup/ingest');
  },

  switchDatabase: async ({ request }) => {
    const config = getConfig();
    if (!config) throw redirect(303, '/setup');
    const form = await request.formData();
    const dbEngine = normalizeDbEngine(form.get('dbEngine'));
    if (dbEngine === config.dbEngine) return { ok: true, message: `Already using ${dbEngine}.` };
    await closeDB();
    updateConfig({ dbEngine, dbPath: defaultDbPathForArchive(config.archivePath, dbEngine) });
    throw redirect(303, '/setup/ingest');
  },

  generateThumbnails: async () => {
    try { startAssetJob('thumbnail'); }
    catch (e) { return fail(400, { error: e.message }); }
    throw redirect(303, '/server?tab=assets');
  },

  generatePreviews: async () => {
    try { startAssetJob('preview'); }
    catch (e) { return fail(400, { error: e.message }); }
    throw redirect(303, '/server?tab=assets');
  },

  cancelAssetJob: async () => {
    requestAssetJobCancel();
    throw redirect(303, '/server?tab=assets');
  },

  updateAccessSettings: async ({ request }) => {
    const config = getConfig();
    if (!config) throw redirect(303, '/setup');
    const form = await request.formData();
    const serverAccessMode = String(form.get('serverAccessMode') || 'local') === 'lan' ? 'lan' : 'local';
    const showFullPaths = form.get('showFullPaths') === 'on';
    const previousMode = config.serverAccessMode || 'local';
    updateConfig({ serverAccessMode, showFullPaths });
    // Server bind address (127.0.0.1 vs 0.0.0.0) is decided at process startup
    // by the launcher script. A live config change cannot rebind the listening
    // socket — surface a clear restart hint when the access mode actually moved.
    return {
      accessSaved: true,
      accessChanged: previousMode !== serverAccessMode,
      previousMode,
      newMode: serverAccessMode,
    };
  },

  optimizeDatabase: async () => {
    try {
      const result = await optimizeDb();
      return { optimized: result };
    } catch (e) {
      return fail(400, { error: e.message });
    }
  },

  updatePeopleLimits: async ({ request }) => {
    const config = getConfig();
    if (!config) throw redirect(303, '/setup');
    const form = await request.formData();
    const initial = Math.max(25, Math.min(500, parseInt(form.get('personInitialLimit') || '100', 10) || 100));
    const batch = Math.max(50, Math.min(1000, parseInt(form.get('personLoadLimit') || '250', 10) || 250));
    const info = ['minimal', 'profile', 'rich'].includes(String(form.get('personIndexInfo') || '').toLowerCase()) ? String(form.get('personIndexInfo')).toLowerCase() : 'minimal';
    const showImages = form.get('personShowImages') === 'on';
    const mobileFeedLayoutRaw = String(form.get('mobileFeedLayout') || 'auto').toLowerCase();
    const mobileFeedLayout = ['auto', 'grid', 'reel'].includes(mobileFeedLayoutRaw) ? mobileFeedLayoutRaw : 'auto';
    updateConfig({ personInitialLimit: initial, personLoadLimit: batch, personIndexInfo: info, personShowImages: showImages, mobileFeedLayout });
    throw redirect(303, '/server?tab=display');
  },

  rebuildPersonSummaries: async () => {
    try {
      await rebuildSummaries();
      return { summaryRebuilt: true };
    } catch (e) {
      return fail(400, { error: e.message });
    }
  },
  reconcileAvatars: async () => {
    const config = getConfig();
    if (!config) throw redirect(303, '/setup');
    try {
      const db = await getDB();
      const result = await reconcileAvatarRegistry(db, config.archivePath);
      return { avatarReconcile: result };
    } catch (e) {
      return fail(400, { error: e.message });
    }
  },

  downloadAvatars: async () => {
    const config = getConfig();
    if (!config) throw redirect(303, '/setup');
    try { startAvatarJob(); }
    catch (e) { return fail(400, { error: e.message }); }
    throw redirect(303, '/server?tab=assets');
  },

  cancelAvatarJob: async () => {
    requestAvatarJobCancel();
    throw redirect(303, '/server?tab=assets');
  },

  refreshExtractPermalinks: async () => {
    try { startExtractPermalinks(); }
    catch (e) { return fail(400, { error: e.message }); }
    throw redirect(303, '/server?tab=assets');
  },

  refreshDedupeLinks: async () => {
    try { startDedupeLinks(); }
    catch (e) { return fail(400, { error: e.message }); }
    throw redirect(303, '/server?tab=assets');
  },

  refreshFetchHtml: async () => {
    try { startFetchHtml(); }
    catch (e) { return fail(400, { error: e.message }); }
    throw redirect(303, '/server?tab=assets');
  },

  refreshExtractHtml: async () => {
    try { startExtractHtml(); }
    catch (e) { return fail(400, { error: e.message }); }
    throw redirect(303, '/server?tab=assets');
  },

  refreshDownloadAssets: async ({ request }) => {
    const form = await request.formData();
    const types = {
      avatars:    form.get('want_avatars')    === 'on',
      thumbnails: form.get('want_thumbnails') === 'on',
      gifs:       form.get('want_gifs')       === 'on',
    };
    try { startAssetDownload(types); }
    catch (e) { return fail(400, { error: e.message }); }
    throw redirect(303, '/server?tab=assets');
  },

  refreshRunAll: async ({ request }) => {
    const form = await request.formData();
    const types = {
      avatars:    form.get('want_avatars')    === 'on',
      thumbnails: form.get('want_thumbnails') === 'on',
      gifs:       form.get('want_gifs')       === 'on',
    };
    try { startRunAll(types); }
    catch (e) { return fail(400, { error: e.message }); }
    throw redirect(303, '/server?tab=assets');
  },

  cancelRefreshJob: async () => {
    requestRefreshJobCancel();
    throw redirect(303, '/server?tab=assets');
  },

  bookmarkCheck: async ({ request }) => {
    const form = await request.formData();
    const url = String(form.get('url') || '').trim();
    if (!url) return fail(400, { bookmarkError: 'Paste a Sora /p/ post URL.', bookmarkUrl: url });
    const postId = extractPostIdFromUrl(url);
    if (!postId) return fail(400, { bookmarkError: 'Not a valid Sora post URL — needs /p/s_… in the path. Profile URLs are not supported.', bookmarkUrl: url });
    try {
      // Drop any stale singleton so the page never shows leftover results
      // from a prior submission while we figure out what this one is.
      try { clearBookmarkJob(); } catch {}
      const lookup = await lookupBookmarkInDb(postId);
      if (lookup.found) {
        // Stash on the singleton instead of returning form data, so we can
        // redirect to a clean URL and the panel reads from data.bookmarkJob.
        setBookmarkLookupOnly({ url, lookup });
      } else {
        startBookmarkJob({ url });
      }
    } catch (e) {
      return fail(400, { bookmarkError: e.message, bookmarkUrl: url });
    }
    throw redirect(303, '/server?tab=assets');
  },

  bookmarkTopUp: async ({ request }) => {
    const form = await request.formData();
    const url = String(form.get('url') || '').trim();
    if (!url) return fail(400, { bookmarkError: 'Paste a Sora /p/ post URL.', bookmarkUrl: url });
    try {
      try { clearBookmarkJob(); } catch {}
      startBookmarkJob({ url, topUpOnly: true });
    } catch (e) {
      return fail(400, { bookmarkError: e.message, bookmarkUrl: url });
    }
    throw redirect(303, '/server?tab=assets');
  },

  cancelBookmarkJob: async () => {
    requestBookmarkJobCancel();
    throw redirect(303, '/server?tab=assets');
  },

  clearBookmark: async () => {
    try { clearBookmarkJob(); } catch {}
    throw redirect(303, '/server?tab=assets');
  },
  importMetadata: async ({ request }) => {
    const config = getConfig();
    if (!config) throw redirect(303, '/setup');
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string' || !file.size) {
      return fail(400, { importMetadataError: 'Pick a JSON file to import.' });
    }
    // Cheap header check before slurping the whole thing into memory — keeps
    // accidental uploads of huge unrelated files from blowing up Node.
    const MAX_BYTES = 500 * 1024 * 1024; // 500 MB — generous for big archives
    if (file.size > MAX_BYTES) {
      return fail(400, { importMetadataError: `File is ${Math.round(file.size / 1024 / 1024)} MB; max is ${MAX_BYTES / 1024 / 1024} MB.` });
    }
    let parsed;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch (e) {
      return fail(400, { importMetadataError: `Not valid JSON: ${e.message}` });
    }
    const v = validateImportPayload(parsed);
    if (!v.ok) return fail(400, { importMetadataError: `Not a sora-view-metadata.json export: ${v.reason}` });
    try {
      const db = await getDB();
      const stats = await applyMetadataImport(db, parsed);
      return { importMetadata: stats };
    } catch (e) {
      return fail(500, { importMetadataError: e.message });
    }
  },

  analyzeCharacterMentions: async () => {
    const config = getConfig();
    if (!config) throw redirect(303, '/setup');
    try {
      await closeDB();
      const stats = await analyzePromptCharacterMentions({ dbPath: config.dbPath, dbEngine: config.dbEngine || 'sqlite' });
      await closeDB();
      return { mentionAnalysis: stats };
    } catch (e) {
      return fail(400, { error: e.message });
    }
  },
};
