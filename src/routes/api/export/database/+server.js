import { error } from '@sveltejs/kit';
import { getConfig } from '$lib/config.js';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

export async function GET() {
  const config = getConfig();
  if (!config?.dbPath || !fs.existsSync(config.dbPath)) throw error(404, 'Database not found');
  const ext = path.extname(config.dbPath) || '.db';
  const filename = `sora-view-backup-${new Date().toISOString().slice(0,10)}${ext}`;
  const stream = Readable.toWeb(fs.createReadStream(config.dbPath));
  return new Response(stream, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${filename}"` } });
}
