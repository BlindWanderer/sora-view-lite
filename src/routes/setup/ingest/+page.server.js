import { fail, redirect } from '@sveltejs/kit';
import { getAppState, getConfig, validateArchivePath } from '$lib/config.js';
import { getIngestJob, startIngestJob } from '$lib/server/ingest-job.js';

export function load() {
  const config = getConfig();
  if (!config) throw redirect(302, '/setup');

  return {
    appState: getAppState(),
    config,
    job: getIngestJob(),
  };
}

export const actions = {
  start: async () => {
    const config = getConfig();
    if (!config) {
      return fail(400, { error: 'Setup has not been completed.' });
    }

    const archive = validateArchivePath(config.archivePath);
    if (!archive.ok) {
      return fail(400, { error: archive.error });
    }

    startIngestJob(config);
    throw redirect(303, '/setup/ingest');
  }
};
