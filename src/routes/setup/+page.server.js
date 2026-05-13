import { fail, redirect } from '@sveltejs/kit';
import { defaultDbPathForArchive, getAppState, getConfig, normalizeDbEngine, normalizeManifestMode, saveConfig, validateArchivePath } from '$lib/config.js';
import { closeDB } from '$lib/db.js';
import path from 'path';

export function load({ url }) {
  const config = getConfig();
  const prefillArchivePath = String(url.searchParams.get('archivePath') || '').trim();
  const prefillDbEngine = normalizeDbEngine(url.searchParams.get('dbEngine') || config?.dbEngine || 'sqlite');
  const prefillManifestMode = normalizeManifestMode(url.searchParams.get('manifestMode') || config?.manifestMode || 'unknown');

  return {
    appState: getAppState(),
    config,
    prefillArchivePath,
    prefillDbEngine,
    prefillManifestMode,
    suggestedDbPath: (prefillArchivePath || config?.archivePath)
      ? defaultDbPathForArchive(prefillArchivePath || config.archivePath, prefillDbEngine)
      : ''
  };
}

export const actions = {
  save: async ({ request }) => {
    const form = await request.formData();
    const archivePath = String(form.get('archivePath') || '').trim();
    const dbPathInput = String(form.get('dbPath') || '').trim();
    const dbEngine = normalizeDbEngine(form.get('dbEngine'));
    const manifestMode = normalizeManifestMode(form.get('manifestMode'));

    const archive = validateArchivePath(archivePath);
    if (!archive.ok) {
      return fail(400, { error: archive.error, archivePath, dbPath: dbPathInput, dbEngine, manifestMode });
    }

    const resolvedArchive = archive.path;
    const resolvedDb = path.resolve(dbPathInput || defaultDbPathForArchive(resolvedArchive, dbEngine));

    await closeDB();
    saveConfig({ archivePath: resolvedArchive, dbPath: resolvedDb, dbEngine, manifestMode, appPort: 5173 });
    throw redirect(303, '/setup/ingest');
  }
};
