/**
 * Detect whether Playwright + Chromium are available without forcing them
 * to be a hard dependency of the app.
 *
 * Playwright is declared as an optionalDependency so `npm install` does not
 * fail if Chromium download is blocked or the platform is unsupported. The
 * server panel uses this check to either show install instructions or a
 * green "ready" pill before letting the user click "Run step 3".
 *
 * Returns:
 *   { ok: true, version }                                 -> ready to fetch
 *   { ok: false, reason: 'missing-package' }              -> npm install needed
 *   { ok: false, reason: 'missing-browser', error }       -> npx playwright install chromium needed
 *   { ok: false, reason: 'load-error', error }            -> something else broke
 */

// Vite/Rollup is the bundler for the SvelteKit server. We do NOT want it to
// try to resolve `playwright` at build time because it may not be present.
// Bypass static analysis with a runtime-only dynamic import.
const runtimeImport = Function('specifier', 'return import(specifier)');

let cached = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

// Which Playwright launch path worked last time:
//   null   -> bundled chromium (default)
//   'chrome' -> system Chrome via channel:'chrome' (fallback for Ubuntu 24/26
//             and other hosts where Playwright's chromium libs don't run).
let preferredChannel = null;

/**
 * Launch a headless Chromium with a fallback to the system-installed Chrome.
 * Playwright's bundled chromium fails on Ubuntu 24.04+/26 (it ships against
 * older system libs); when that happens, retry with `channel: 'chrome'` so
 * we use whatever Google Chrome the user already has installed.
 *
 * Latches onto the working channel for the rest of the process so we don't
 * eat the failed-launch cost on every call.
 */
export async function launchChromium(playwrightModule, opts = {}) {
  const mod = playwrightModule;
  if (preferredChannel) {
    return mod.chromium.launch({ ...opts, headless: true, channel: preferredChannel });
  }
  try {
    return await mod.chromium.launch({ ...opts, headless: true });
  } catch (e) {
    const browser = await mod.chromium.launch({ ...opts, headless: true, channel: 'chrome' });
    preferredChannel = 'chrome';
    return browser;
  }
}

/** Returns the channel currently in use ('chrome' or null for bundled chromium). */
export function getChromiumChannel() { return preferredChannel; }

export async function checkPlaywright({ probeBrowser = true } = {}) {
  const now = Date.now();
  if (cached && (now - cachedAt) < CACHE_MS) return cached;

  let mod;
  try {
    mod = await runtimeImport('playwright');
  } catch (e) {
    cached = { ok: false, reason: 'missing-package', error: e.message };
    cachedAt = now;
    return cached;
  }

  let version = null;
  try {
    // require.resolve is fine here — playwright ships a CommonJS package.json
    const fs = await runtimeImport('fs');
    const path = await runtimeImport('path');
    const url = await runtimeImport('url');
    // mod is the playwright module; package.json sits next to its entry point
    const pkgUrl = new URL('./package.json', mod.default ? import.meta.url : import.meta.url);
    // Easier: ask npm via process for the version. Skip if it fails — non-critical.
    const { createRequire } = await runtimeImport('module');
    const req = createRequire(import.meta.url);
    const pkg = req('playwright/package.json');
    version = pkg?.version || null;
  } catch {
    // Version is decorative; failure here is fine.
  }

  if (!probeBrowser) {
    cached = { ok: true, version };
    cachedAt = now;
    return cached;
  }

  // Try to launch chromium briefly. If the binary isn't installed, this
  // throws — we fall back to the system Chrome channel before giving up.
  let browser;
  try {
    browser = await launchChromium(mod);
    await browser.close();
  } catch (e) {
    cached = {
      ok: false,
      reason: e.message?.includes("Executable doesn't exist") ? 'missing-browser' : 'load-error',
      version,
      error: e.message,
    };
    cachedAt = now;
    return cached;
  }

  cached = { ok: true, version, channel: preferredChannel };
  cachedAt = now;
  return cached;
}

/**
 * Force the cache to be cleared. The panel calls this after an install action
 * so the next render shows the new state.
 */
export function clearPlaywrightCache() {
  cached = null;
  cachedAt = 0;
}
