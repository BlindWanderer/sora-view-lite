import fs from 'fs';
import path from 'path';
import { error } from '@sveltejs/kit';
import { getConfig } from '$lib/config.js';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

function safeName(value = '') {
  return String(value).replace(/[\\/]/g, '').trim();
}

function candidates(root, name) {
  const n = safeName(name);
  if (!n) return [];
  const dirs = [
    path.join(root, 'profiles', n),
    path.join(root, 'profile', n),
    path.join(root, 'profiles'),
    path.join(root, 'profile'),
  ];
  const stems = [`${n}.profile`, n, `@${n}`];
  const out = [];
  for (const dir of dirs) {
    for (const stem of stems) for (const ext of IMAGE_EXTS) out.push(path.join(dir, stem + ext));
  }
  return out;
}

export function GET({ params }) {
  const config = getConfig();
  if (!config) throw error(404, 'No config.');
  const root = path.resolve(config.archivePath);
  for (const file of candidates(root, params.name)) {
    const resolved = path.resolve(file);
    if (!resolved.startsWith(root)) continue;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const ext = path.extname(resolved).toLowerCase();
      return new Response(fs.readFileSync(resolved), {
        headers: {
          'content-type': MIME[ext] || 'application/octet-stream',
          'cache-control': 'public, max-age=300',
        },
      });
    }
  }
  throw error(404, 'No local profile image.');
}
