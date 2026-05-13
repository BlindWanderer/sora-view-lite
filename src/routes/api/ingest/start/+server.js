import { json } from '@sveltejs/kit';
import { getConfig, validateArchivePath } from '$lib/config.js';
import { startIngestJob } from '$lib/server/ingest-job.js';

export async function POST() {
  const config = getConfig();

  if (!config) {
    return json({ error: 'Setup has not been completed.' }, { status: 400 });
  }

  const archive = validateArchivePath(config.archivePath);
  if (!archive.ok) {
    return json({ error: archive.error }, { status: 400 });
  }

  const job = startIngestJob(config);
  return json(job);
}
