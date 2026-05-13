import { json } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * GET /api/browse?path=C:\Users\...
 * Returns subdirectories of the given path.
 * If no path given, returns filesystem roots.
 */
export function GET({ url }) {
  const reqPath = url.searchParams.get('path') || '';

  try {
    // No path → return roots
    if (!reqPath) {
      const roots = getRoots();
      return json({ path: '', entries: roots, sep: path.sep });
    }

    const resolved = path.resolve(reqPath);

    if (!fs.existsSync(resolved)) {
      return json({ error: 'Path not found' }, { status: 404 });
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return json({ error: 'Not a directory' }, { status: 400 });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        fullPath: path.join(resolved, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Build breadcrumb parts
    const parts = buildBreadcrumbs(resolved);

    return json({ path: resolved, entries, parts, sep: path.sep });

  } catch (err) {
    return json({ error: err.message }, { status: 500 });
  }
}

function getRoots() {
  if (process.platform === 'win32') {
    // Probe common drive letters
    const drives = [];
    for (let i = 67; i <= 90; i++) { // C–Z
      const drive = String.fromCharCode(i) + ':\\';
      try {
        fs.accessSync(drive);
        drives.push({ name: drive, fullPath: drive });
      } catch {}
    }
    return drives.length ? drives : [{ name: 'C:\\', fullPath: 'C:\\' }];
  }
  // Unix: start at home and root
  return [
    { name: '~  (Home)', fullPath: os.homedir() },
    { name: '/  (Root)', fullPath: '/' },
  ];
}

function buildBreadcrumbs(fullPath) {
  const parts = [];
  let current = fullPath;
  while (true) {
    const parent = path.dirname(current);
    parts.unshift({ name: path.basename(current) || current, fullPath: current });
    if (parent === current) break; // reached root
    current = parent;
  }
  return parts;
}
