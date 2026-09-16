/* Site Clone Collector — background service worker.
 * The dashboard page (dashboard/dashboard.html) does the heavy lifting;
 * the worker only opens it and cleans up dynamically registered scripts. */

const DASHBOARD_WIDTH = 1040;
const DASHBOARD_HEIGHT = 900;

async function cleanupRegisteredScripts() {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    const ids = scripts.map((s) => s.id).filter((id) => id.startsWith('sc-hook-'));
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  } catch (e) {
    /* ignore */
  }
}

chrome.runtime.onInstalled.addListener(cleanupRegisteredScripts);
chrome.runtime.onStartup.addListener(cleanupRegisteredScripts);

async function openDashboard({ tabId, windowId, screen }) {
  const params = new URLSearchParams();
  if (tabId != null) params.set('tabId', String(tabId));
  if (windowId != null) params.set('windowId', String(windowId));
  const url = chrome.runtime.getURL('dashboard/dashboard.html') + (params.toString() ? `?${params}` : '');

  const create = { url, type: 'popup', width: DASHBOARD_WIDTH, height: DASHBOARD_HEIGHT, focused: true };
  // Place the dashboard at the right edge so it covers as little of the target window as possible
  // (captureVisibleTab needs the target window to stay visible).
  if (screen && screen.availWidth) {
    create.left = Math.max(0, Math.floor(screen.availWidth - DASHBOARD_WIDTH));
    create.top = 0;
    create.height = Math.min(DASHBOARD_HEIGHT, screen.availHeight || DASHBOARD_HEIGHT);
  }
  // Fall back to progressively safer bounds (small screens, multi-monitor offsets, headless virtual screens).
  const attempts = [create, { ...create, left: undefined, top: undefined }, { url, type: 'popup', width: 900, height: 700 }, { url, type: 'popup' }];
  let lastErr;
  for (const opts of attempts) {
    const clean = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
    try {
      const win = await chrome.windows.create(clean);
      return { windowId: win.id };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'open-dashboard') {
    openDashboard(msg)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});
