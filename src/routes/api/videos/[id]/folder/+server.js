import { json } from '@sveltejs/kit';
import { getVideo } from '$lib/db.js';
import { getConfig } from '$lib/config.js';
import { spawn } from 'child_process';
import path from 'path';

function openFolder(filePath) {
  const dir = path.dirname(filePath);
  if (process.platform === 'win32') return spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' });
  if (process.platform === 'darwin') return spawn('open', [dir], { detached: true, stdio: 'ignore' });
  return spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' });
}

export async function POST({ params }) {
  const video = await getVideo(params.id);
  const config = getConfig();
  const filePath = video?.full_path || (config?.archivePath && video?.file_path ? path.resolve(config.archivePath, video.file_path) : video?.file_path);
  if (!filePath) return json({ ok: false, error: 'No local path found.' }, { status: 404 });
  try {
    const child = openFolder(filePath);
    child.unref?.();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e.message }, { status: 500 });
  }
}
