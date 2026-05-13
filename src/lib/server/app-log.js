import fs from 'fs';
import path from 'path';

export const APP_DATA_DIR = path.resolve('.sora-view-lite');
export const LOG_DIR = path.join(APP_DATA_DIR, 'logs');
export const APP_LOG_PATH = path.join(LOG_DIR, 'app.log');
export const IMPORT_REPORT_PATH = path.join(APP_DATA_DIR, 'last-import-report.json');

function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function appendLog(level = 'info', message = '', meta = null) {
  try {
    ensureDirs();
    const row = {
      at: new Date().toISOString(),
      level: String(level || 'info'),
      message: String(message || ''),
      ...(meta ? { meta } : {})
    };
    fs.appendFileSync(APP_LOG_PATH, JSON.stringify(row) + '\n', 'utf8');
  } catch {
    // File logging should never break app flow.
  }
}

export function readRecentLogs(limit = 100) {
  try {
    if (!fs.existsSync(APP_LOG_PATH)) return [];
    const lines = fs.readFileSync(APP_LOG_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(500, Number(limit) || 100))).map((line) => {
      try { return JSON.parse(line); }
      catch { return { at: '', level: 'info', message: line }; }
    }).reverse();
  } catch (e) {
    return [{ at: new Date().toISOString(), level: 'error', message: `Could not read app log: ${e.message}` }];
  }
}

export function writeImportReport(report = {}) {
  try {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    fs.writeFileSync(IMPORT_REPORT_PATH, JSON.stringify({ ...report, savedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (e) {
    appendLog('warn', `Could not write import report: ${e.message}`);
  }
}

export function readImportReport() {
  try {
    if (!fs.existsSync(IMPORT_REPORT_PATH)) return null;
    return JSON.parse(fs.readFileSync(IMPORT_REPORT_PATH, 'utf8'));
  } catch (e) {
    return { ok: false, error: `Could not read import report: ${e.message}` };
  }
}
