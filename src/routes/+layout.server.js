import { getAppState } from '$lib/config.js';
import { redirect } from '@sveltejs/kit';
import { getIngestJob } from '$lib/server/ingest-job.js';

export function load({ url, cookies }) {
  const appState = getAppState();
  const path = url.pathname;
  const isSetupPath = path.startsWith('/setup');
  const ingestJob = getIngestJob();

  if (ingestJob?.running && !isSetupPath) {
    throw redirect(302, '/setup/ingest');
  }

  if (!appState.ready && !isSetupPath) {
    if (appState.state === 'needs_setup' || appState.state === 'missing_archive') {
      throw redirect(302, '/setup');
    }
    throw redirect(302, '/setup/ingest');
  }

  const rawTheme = cookies.get('sora_theme');
  const theme = ['dark', 'light', 'sora'].includes(rawTheme) ? rawTheme : 'dark';

  return { appState, theme, clientSettings: { showFullPaths: appState.config?.showFullPaths !== false } };
}
