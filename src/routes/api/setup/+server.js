import { json } from '@sveltejs/kit';
import { defaultDbPathForArchive, normalizeDbEngine, normalizeManifestMode, saveConfig, validateArchivePath } from '$lib/config.js';
import { closeDB } from '$lib/db.js';
import path from 'path';

export async function POST({ request }) {
  try {
    const body = await request.json();
    const archive = validateArchivePath(body.archivePath || '');
    if (!archive.ok) return json({ error: archive.error }, { status: 400 });

    const dbEngine = normalizeDbEngine(body.dbEngine);
    const manifestMode = normalizeManifestMode(body.manifestMode);
    const resolvedArchive = archive.path;
    const resolvedDb = path.resolve((body.dbPath || '').trim() || defaultDbPathForArchive(resolvedArchive, dbEngine));

    await closeDB();
    saveConfig({ archivePath: resolvedArchive, dbPath: resolvedDb, dbEngine, manifestMode, appPort: 5173 });
    return json({ ok: true, archivePath: resolvedArchive, dbPath: resolvedDb, dbEngine, manifestMode });
  } catch (err) {
    return json({ error: err.message }, { status: 500 });
  }
}
