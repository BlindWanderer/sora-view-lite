import fs from 'fs';
import os from 'os';
import path from 'path';
import { getConfig } from '$lib/config.js';

function defaultStartPath() {
  const config = getConfig();
  if (config?.archivePath && fs.existsSync(config.archivePath)) return config.archivePath;
  return os.homedir();
}

function listWindowsDrives() {
  const drives = [];
  for (let code = 65; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    try {
      if (fs.existsSync(drive)) {
        drives.push({ name: drive, fullPath: drive });
      }
    } catch {
      // Ignore inaccessible drives.
    }
  }
  return drives;
}

function safeListDirectories(currentPath) {
  try {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        fullPath: path.join(currentPath, entry.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { entries, error: '' };
  } catch (e) {
    return { entries: [], error: e.message };
  }
}

function getBrowseState(rawPath) {
  const isWindows = process.platform === 'win32';

  if (isWindows && (!rawPath || rawPath === 'drives')) {
    return {
      currentPath: '',
      parentPath: '',
      isRootListing: true,
      entries: listWindowsDrives(),
      error: '',
      config: getConfig()
    };
  }

  let currentPath = rawPath ? path.resolve(rawPath) : defaultStartPath();

  if (!fs.existsSync(currentPath) || !fs.statSync(currentPath).isDirectory()) {
    currentPath = defaultStartPath();
  }

  const { entries, error } = safeListDirectories(currentPath);
  const parsed = path.parse(currentPath);
  const atRoot = currentPath === parsed.root;

  return {
    currentPath,
    parentPath: atRoot ? '' : path.dirname(currentPath),
    rootPath: parsed.root,
    isRootListing: false,
    entries,
    error,
    config: getConfig()
  };
}

export function load({ url }) {
  const requestedPath = url.searchParams.get('path') || '';
  return getBrowseState(requestedPath);
}
