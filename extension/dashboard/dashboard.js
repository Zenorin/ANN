/* Site Clone Collector — dashboard orchestrator (runs in its own extension window). */
(() => {
  'use strict';
  const VERSION = chrome.runtime.getManifest().version;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtBytes = SCReport.fmtBytes;

  // ------------------------------------------------------------------ state
  const state = {
    version: VERSION,
    targetTabId: null,
    targetWindowId: null,
    running: false,
    stop: false,
    captures: [],          // {url, slug, data, screenshots, next, assetRefs, startedAt, ms}
    assets: new Map(),     // url -> {url, path, blob, size, type, status, error, kind, originalSrc}
    assetBytes: 0,
    assetCount: 0,
    sitemap: null,
    siteHost: '',
    selected: null,
    hookRegisteredOrigin: null,
    log: [],
  };
  window.SCD = { state, VERSION };

  // ------------------------------------------------------------------ logging / status
  function log(msg, level = 'info') {
    const t = new Date().toTimeString().slice(0, 8);
    state.log.push({ t, msg, level });
    const el = $('log');
    const span = document.createElement('span');
    span.className = level;
    span.textContent = `[${t}] ${msg}\n`;
    el.appendChild(span);
    if (state.log.length > 2000) { state.log.shift(); el.removeChild(el.firstChild); }
    el.scrollTop = el.scrollHeight;
  }
  function setStatus(text, cls = '') { const el = $('status'); el.textContent = text; el.className = `status ${cls}`; }
  function setProgress(frac) { $('progressBar').style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; }
  function checkStop() { if (state.stop) throw new Error('사용자가 중지했습니다'); }

  // ------------------------------------------------------------------ options
  const OPT_IDS = ['optScreenshot', 'optSections', 'optResponsive', 'optWidths', 'optShotFormat', 'optMaxShotHeight', 'optStyles', 'optMaxStyled', 'optScrollFirst', 'optReact', 'optNetwork', 'optHookFromLoad', 'optStorageValues', 'optAssets', 'optAssetImages', 'optAssetFonts', 'optAssetCss', 'optAssetJs', 'optAssetVideo', 'optAssetSrcset', 'optAssetMaxMb', 'optAssetTotalMb', 'optCrawl', 'optMaxPages', 'optPathPrefix', 'optNavWait', 'optUseManifest'];
  function readOptions() {
    const v = (id) => { const el = $(id); return el.type === 'checkbox' ? el.checked : el.value; };
    return {
      screenshot: v('optScreenshot'), sections: v('optSections'), responsive: v('optResponsive'),
      widths: String(v('optWidths')).split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((x) => x >= 240 && x <= 4000),
      shotFormat: v('optShotFormat'), maxShotHeight: parseInt(v('optMaxShotHeight'), 10) || 30000,
      styles: v('optStyles'), maxStyledElements: parseInt(v('optMaxStyled'), 10) || 6000, scrollFirst: v('optScrollFirst'),
      react: v('optReact'), network: v('optNetwork'), hookFromLoad: v('optHookFromLoad'), storageValues: v('optStorageValues'),
      assets: v('optAssets'), assetImages: v('optAssetImages'), assetFonts: v('optAssetFonts'), assetCss: v('optAssetCss'), assetJs: v('optAssetJs'), assetVideo: v('optAssetVideo'), assetSrcset: v('optAssetSrcset'),
      assetMaxBytes: (parseFloat(v('optAssetMaxMb')) || 25) * 1048576, assetTotalBytes: (parseFloat(v('optAssetTotalMb')) || 400) * 1048576,
      crawl: v('optCrawl'), maxPages: parseInt(v('optMaxPages'), 10) || 20, pathPrefix: String(v('optPathPrefix') || '').trim(), navWait: parseInt(v('optNavWait'), 10) || 0, useManifest: v('optUseManifest'),
    };
  }
  async function saveOptions() {
    const o = {};
    for (const id of OPT_IDS) { const el = $(id); o[id] = el.type === 'checkbox' ? el.checked : el.value; }
    try { await chrome.storage.local.set({ options: o }); } catch { /* ignore */ }
  }
  async function loadOptions() {
    try {
      const { options } = await chrome.storage.local.get('options');
      if (!options) return;
      for (const id of OPT_IDS) { const el = $(id); if (!(id in options)) continue; if (el.type === 'checkbox') el.checked = !!options[id]; else el.value = options[id]; }
    } catch { /* ignore */ }
  }
  window.SCD.setOptions = (patch) => { for (const [k, v] of Object.entries(patch)) { const el = $(k); if (!el) continue; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } };

  // ------------------------------------------------------------------ tabs
  async function refreshTabs() {
    const tabs = await chrome.tabs.query({});
    const sel = $('tabSelect');
    sel.innerHTML = '';
    for (const t of tabs) {
      if (!/^https?:/i.test(t.url || '')) continue;
      const o = document.createElement('option');
      o.value = String(t.id);
      o.dataset.windowId = String(t.windowId);
      o.textContent = `${(t.title || '').slice(0, 60)} — ${t.url.slice(0, 90)}`;
      if (t.id === state.targetTabId) o.selected = true;
      sel.appendChild(o);
    }
    if (!sel.value && sel.options.length) { state.targetTabId = Number(sel.options[0].value); state.targetWindowId = Number(sel.options[0].dataset.windowId); }
  }
  function selectTab(tabId, windowId) { state.targetTabId = tabId; state.targetWindowId = windowId; const sel = $('tabSelect'); sel.value = String(tabId); }
  window.SCD.selectTab = async (tabId) => { const t = await chrome.tabs.get(tabId); selectTab(t.id, t.windowId); await refreshTabs(); };

  // ------------------------------------------------------------------ messaging with the target tab
  function sendToTab(tabId, msg, { timeoutMs = 120000 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error(`탭 응답 시간 초과: ${msg.cmd}`)); } }, timeoutMs);
      try {
        chrome.tabs.sendMessage(tabId, { __sc: true, ...msg }, (resp) => {
          if (done) return;
          done = true; clearTimeout(timer);
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!resp) return reject(new Error('응답 없음'));
          if (!resp.ok) return reject(new Error(resp.error));
          resolve(resp.data);
        });
      } catch (e) { done = true; clearTimeout(timer); reject(e); }
    });
  }
  async function ensureCollector(tabId) {
    try { return await sendToTab(tabId, { cmd: 'ping' }, { timeoutMs: 1500 }); }
    catch { /* not injected yet */ }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/collector.js'] });
    return sendToTab(tabId, { cmd: 'ping' }, { timeoutMs: 5000 });
  }
  async function ensureHook(tabId) {
    const r = await sendToTab(tabId, { cmd: 'hook:ping' }, { timeoutMs: 3000 });
    if (r && r.present) return true;
    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['content/hook.js'] });
    const r2 = await sendToTab(tabId, { cmd: 'hook:ping' }, { timeoutMs: 3000 });
    return !!(r2 && r2.present);
  }
  async function registerHookForOrigin(origin) {
    const id = `sc-hook-${origin.replace(/[^\w]/g, '_')}`;
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
    if (existing && existing.length) { state.hookRegisteredOrigin = origin; return false; }
    await chrome.scripting.registerContentScripts([{ id, matches: [`${origin}/*`], js: ['content/hook.js'], runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: false }]);
    state.hookRegisteredOrigin = origin;
    log(`MAIN 훅을 ${origin} 에 document_start 로 등록했습니다 (로드 시점부터 기록).`);
    return true;
  }
  async function unregisterHooks() {
    try {
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      const ids = scripts.map((s) => s.id).filter((i) => i.startsWith('sc-hook-'));
      if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
    } catch { /* ignore */ }
    state.hookRegisteredOrigin = null;
  }
  function waitTabComplete(tabId, timeoutMs = 45000) {
    return new Promise((resolve) => {
      let finished = false;
      const timer = setTimeout(() => { if (!finished) { finished = true; chrome.tabs.onUpdated.removeListener(onUpd); resolve('timeout'); } }, timeoutMs);
      function onUpd(id, info) {
        if (id !== tabId || info.status !== 'complete' || finished) return;
        finished = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpd); resolve('complete');
      }
      chrome.tabs.onUpdated.addListener(onUpd);
    });
  }
  async function navigateTab(tabId, url, opts) {
    const done = waitTabComplete(tabId);
    await chrome.tabs.update(tabId, { url, active: true });
    const r = await done;
    if (opts.navWait) await sleep(opts.navWait);
    return r;
  }
  async function reloadTab(tabId, opts) {
    const done = waitTabComplete(tabId);
    await chrome.tabs.reload(tabId);
    const r = await done;
    if (opts.navWait) await sleep(opts.navWait);
    return r;
  }
  async function fetchPart(tabId, name) {
    let offset = 0, text = '', total = Infinity;
    while (offset < total) {
      const r = await sendToTab(tabId, { cmd: 'part', name, offset, length: 4_000_000 });
      text += r.text; total = r.total; offset += 4_000_000;
      if (r.done) break;
    }
    return text ? JSON.parse(text) : null;
  }

  // ------------------------------------------------------------------ screenshots
  let lastCaptureAt = 0;
  async function captureFrame(windowId, opts) {
    const wait = 560 - (Date.now() - lastCaptureAt);
    if (wait > 0) await sleep(wait);
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, opts.shotFormat === 'jpeg' ? { format: 'jpeg', quality: 92 } : { format: 'png' });
    lastCaptureAt = Date.now();
    return dataUrl;
  }
  async function loadBitmap(dataUrl) { const blob = await (await fetch(dataUrl)).blob(); return createImageBitmap(blob); }

  async function fullPageScreenshot(tabId, windowId, opts, label) {
    const info = await sendToTab(tabId, { cmd: 'shot:prepare' });
    const frames = [];
    try {
      const step = info.viewportHeight;
      const rect = info.scrollerRect;
      const total = Math.min(info.scrollHeight, opts.maxShotHeight);
      const positions = [];
      for (let y = 0; y < total; y += step) positions.push(y);
      if (!positions.length) positions.push(0);
      if (positions.length > 1) positions[positions.length - 1] = Math.max(0, total - step);
      // dedupe (very short pages)
      const uniq = Array.from(new Set(positions));
      log(`스크린샷 ${label}: ${uniq.length}프레임 (문서 ${info.scrollHeight}px, 뷰포트 ${info.viewportWidth}×${info.viewportHeight}, DPR ${info.dpr}${info.isWindow ? '' : ', 내부 스크롤 컨테이너 ' + info.scrollerPath})`);
      for (let i = 0; i < uniq.length; i++) {
        checkStop();
        const isLast = i === uniq.length - 1;
        const r = await sendToTab(tabId, { cmd: 'shot:scrollTo', y: uniq[i], frameIndex: i, isLast });
        const dataUrl = await captureFrame(windowId, opts);
        frames.push({ y: r.y, dataUrl });
        setProgress((i + 1) / uniq.length);
      }
      const shot = await stitch(frames, info, opts);
      shot.frames = frames.length;
      shot.fixedElements = info.fixed;
      shot.label = label;
      return shot;
    } finally {
      try { await sendToTab(tabId, { cmd: 'shot:restore' }); } catch { /* ignore */ }
    }
  }
  async function stitch(frames, info, opts) {
    const first = await loadBitmap(frames[0].dataUrl);
    const scale = first.width / info.viewportWidth;
    const rect = info.scrollerRect; // css px within viewport
    const lastY = frames[frames.length - 1].y;
    const contentH = Math.min(lastY + rect.height, Math.max(info.scrollHeight, rect.height));
    const topBand = rect.top;
    const bottomBand = Math.max(0, info.viewportHeight - (rect.top + rect.height));
    const cssH = topBand + contentH + bottomBand;
    let outScale = scale;
    const MAX_DIM = 16000;
    if (cssH * scale > MAX_DIM) outScale = MAX_DIM / cssH;
    const W = Math.round(info.viewportWidth * outScale);
    const Hh = Math.round(cssH * outScale);
    const canvas = new OffscreenCanvas(W, Hh);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, Hh);
    const s = outScale / scale; // draw scale from bitmap px to output px
    // top band (above scroller) from first frame
    if (topBand > 0) ctx.drawImage(first, 0, 0, first.width, topBand * scale, 0, 0, W, topBand * outScale);
    for (let i = 0; i < frames.length; i++) {
      const bmp = i === 0 ? first : await loadBitmap(frames[i].dataUrl);
      const sx = rect.left * scale, sy = rect.top * scale, sw = rect.width * scale, sh = rect.height * scale;
      const dy = (topBand + frames[i].y) * outScale;
      ctx.drawImage(bmp, sx, sy, sw, sh, rect.left * outScale, dy, sw * s, sh * s);
      if (i !== 0) bmp.close();
    }
    if (bottomBand > 0) ctx.drawImage(first, 0, (rect.top + rect.height) * scale, first.width, bottomBand * scale, 0, (topBand + contentH) * outScale, W, bottomBand * outScale);
    first.close();
    const blob = await canvas.convertToBlob(opts.shotFormat === 'jpeg' ? { type: 'image/jpeg', quality: 0.92 } : { type: 'image/png' });
    return { blob, width: W, height: Hh, cssWidth: info.viewportWidth, cssHeight: cssH, scale: outScale, format: opts.shotFormat === 'jpeg' ? 'jpg' : 'png', viewportHeight: info.viewportHeight, dpr: info.dpr };
  }
  async function cropSections(shot, sections, opts) {
    const out = [];
    if (!shot || !sections || !sections.length) return out;
    const bmp = await createImageBitmap(shot.blob);
    try {
      let i = 1;
      for (const sec of sections) {
        const r = sec.rect;
        const x = Math.max(0, r.x * shot.scale), y = Math.max(0, r.y * shot.scale);
        const w = Math.min(bmp.width - x, r.w * shot.scale), h = Math.min(bmp.height - y, r.h * shot.scale);
        if (w < 8 || h < 8) continue;
        const c = new OffscreenCanvas(Math.round(w), Math.round(h));
        c.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, Math.round(w), Math.round(h));
        const blob = await c.convertToBlob(opts.shotFormat === 'jpeg' ? { type: 'image/jpeg', quality: 0.9 } : { type: 'image/png' });
        out.push({ name: `${String(i++).padStart(2, '0')}-${sec.name.replace(/[^\w-]/g, '_')}`, blob, rect: r, label: sec.label, path: sec.path, format: shot.format });
      }
    } finally { bmp.close(); }
    return out;
  }
  // Resize the target window until the page's innerWidth matches `target` (self-correcting: window chrome,
  // OS minimum sizes and headless quirks all change the outer/inner relationship).
  // chrome.windows.update rejects bounds that fall mostly outside the screen; retry with progressively safer bounds.
  async function safeWindowUpdate(windowId, props) {
    const attempts = [props];
    if ('left' in props || 'top' in props) { const { left, top, ...rest } = props; attempts.push(rest); }
    attempts.push({ ...props, left: 0, top: 0 });
    let lastErr;
    for (const p of attempts) { try { await chrome.windows.update(windowId, p); return true; } catch (e) { lastErr = e; } }
    log(`창 크기 조정 실패: ${lastErr && lastErr.message}`, 'warn');
    return false;
  }
  async function ensureViewportWidth(tabId, windowId, target, attempts = 4) {
    let vp = await sendToTab(tabId, { cmd: 'viewport' });
    for (let i = 0; i < attempts && Math.abs(vp.innerWidth - target) > 2; i++) {
      const cur = await chrome.windows.get(windowId);
      const ok = await safeWindowUpdate(windowId, { width: Math.max(200, cur.width + (target - vp.innerWidth)) });
      if (!ok) break;
      await sleep(450);
      vp = await sendToTab(tabId, { cmd: 'viewport' });
    }
    return vp.innerWidth;
  }
  async function withViewportWidth(tabId, windowId, targetWidth, fn) {
    const win = await chrome.windows.get(windowId);
    const orig = { state: win.state, width: win.width, height: win.height, left: win.left, top: win.top };
    const vp0 = await sendToTab(tabId, { cmd: 'viewport' });
    try {
      if (win.state !== 'normal') { await safeWindowUpdate(windowId, { state: 'normal' }); await sleep(300); }
      const actual = await ensureViewportWidth(tabId, windowId, targetWidth);
      await sendToTab(tabId, { cmd: 'waitIdle', maxMs: 4000, quietMs: 500 });
      if (Math.abs(actual - targetWidth) > 2) log(`창 너비 ${targetWidth}px 로 맞추지 못했습니다 (실제 ${actual}px, OS 최소 창 크기 제한일 수 있음)`, 'warn');
      return await fn(actual);
    } finally {
      await safeWindowUpdate(windowId, { width: orig.width, height: orig.height, left: orig.left, top: orig.top });
      if (orig.state !== 'normal') await safeWindowUpdate(windowId, { state: orig.state });
      await sleep(400);
      let restored = 0;
      try { restored = await ensureViewportWidth(tabId, windowId, vp0.innerWidth); } catch (e) { log(`뷰포트 복원 확인 실패: ${e.message}`, 'warn'); }
      if (Math.abs(restored - vp0.innerWidth) > 2) log(`뷰포트 너비를 ${vp0.innerWidth}px 로 복원하지 못했습니다 (현재 ${restored}px)`, 'warn');
    }
  }

  // ------------------------------------------------------------------ assets
  const EXT_BY_TYPE = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico', 'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf', 'application/font-woff': '.woff', 'application/font-woff2': '.woff2', 'text/css': '.css', 'text/javascript': '.js', 'application/javascript': '.js', 'application/json': '.json', 'application/manifest+json': '.json', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'text/html': '.html' };
  function hashStr(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }
  function sanitizeSeg(s) { s = s.replace(/[^\w.\-()@%~ ]/g, '_').slice(0, 120); if (s === '.' || s === '..' || !s) s = '_'; return s; }
  function assetPathFor(url, contentType) {
    let u;
    try { u = new URL(url); } catch { return `assets/_invalid/${hashStr(url)}`; }
    const host = sanitizeSeg(u.host || '_');
    let segs;
    try { segs = decodeURIComponent(u.pathname).split('/').filter(Boolean).map(sanitizeSeg); } catch { segs = u.pathname.split('/').filter(Boolean).map(sanitizeSeg); }
    let file = segs.pop() || 'index';
    if (u.search) { const m = file.match(/^(.*?)(\.[a-z0-9]{1,5})?$/i); file = `${m[1]}__${hashStr(u.search)}${m[2] || ''}`; }
    if (!/\.[a-z0-9]{1,5}$/i.test(file)) { const ext = EXT_BY_TYPE[(contentType || '').split(';')[0].trim()]; if (ext) file += ext; }
    return ['assets', host, ...segs, file].join('/');
  }
  function kindFromUrl(url, hint) {
    if (hint) return hint;
    const p = url.split(/[?#]/)[0].toLowerCase();
    if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/.test(p)) return 'image';
    if (/\.(woff2?|ttf|otf|eot)$/.test(p)) return 'font';
    if (/\.css$/.test(p)) return 'css';
    if (/\.(m?js)$/.test(p)) return 'js';
    if (/\.(mp4|webm|mov|m4v|ogv|mp3|m4a|ogg|wav)$/.test(p)) return 'video';
    return 'other';
  }
  function kindAllowed(kind, opts) {
    switch (kind) {
      case 'image': return opts.assetImages;
      case 'font': return opts.assetFonts;
      case 'css': return opts.assetCss;
      case 'js': return opts.assetJs;
      case 'video': return opts.assetVideo;
      default: return true;
    }
  }
  function parseSrcset(s) { return String(s || '').split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean); }
  function collectAssetRefs(cap, opts) {
    const d = cap.data;
    const refs = new Map(); // url -> {kind, from, originalSrc}
    const add = (url, kind, from, extra) => { if (!url || /^(blob|javascript|about|chrome):/i.test(url)) return; if (!refs.has(url)) refs.set(url, { url, kind, from, ...(extra || {}) }); };
    const a = d.assets || {};
    for (const img of a.images || []) {
      if (img.currentSrc) add(img.currentSrc, 'image', 'img'); else if (img.src) add(img.src, 'image', 'img');
      if (img.originalSrc) add(img.originalSrc, 'image', 'next/image original', { optimizedFrom: img.currentSrc || img.src });
      if (opts.assetSrcset) { for (const u of parseSrcset(img.srcset)) add(new URL(u, cap.url).href, 'image', 'srcset'); for (const s of img.sources || []) for (const u of parseSrcset(s.srcset)) add(new URL(u, cap.url).href, 'image', 'picture'); }
    }
    for (const b of a.backgroundImages || []) for (const u of b.urls || []) add(u, kindFromUrl(u, /\.(woff2?|ttf|otf)/.test(u) ? 'font' : 'image'), 'css background');
    for (const f of a.favicons || []) add(f.href, f.rel === 'manifest' ? 'other' : 'image', 'favicon');
    for (const v of a.videos || []) { if (v.poster) add(v.poster, 'image', 'poster'); add(v.currentSrc || v.src, 'video', 'video'); for (const s of v.sources || []) add(s.src, 'video', 'video source'); }
    for (const au of a.audios || []) { add(au.currentSrc || au.src, 'video', 'audio'); for (const s of au.sources || []) add(s.src, 'video', 'audio source'); }
    for (const svg of a.svgs || []) for (const u of svg.useRefs || []) if (u && !u.startsWith('#')) add(new URL(u.split('#')[0], cap.url).href, 'image', 'svg use');
    for (const ff of (d.styles && d.styles.fontFaces) || []) for (const u of ff.srcUrls || []) add(u, 'font', '@font-face');
    for (const s of (d.styles && d.styles.sheets) || []) if (s.href) add(s.href, 'css', 'stylesheet');
    for (const i of (d.styles && d.styles.imports) || []) add(i.href, 'css', '@import');
    for (const l of (d.head && d.head.links) || []) {
      const rel = (l.rel || '').toLowerCase();
      const href = l.hrefAbs;
      if (!href) continue;
      if (rel.includes('stylesheet')) add(href, 'css', 'link stylesheet');
      else if (rel === 'preload' || rel === 'prefetch' || rel === 'modulepreload') { const as = (l.as || '').toLowerCase(); add(href, as === 'font' ? 'font' : as === 'image' ? 'image' : as === 'style' ? 'css' : as === 'script' || rel === 'modulepreload' ? 'js' : as === 'video' ? 'video' : kindFromUrl(href), `link ${rel}`); }
      else if (rel === 'manifest') add(href, 'other', 'manifest');
    }
    for (const s of d.scripts || []) if (s.src) add(s.src, 'js', 'script');
    if (d.frameworkHints && d.frameworkHints.next) for (const u of d.frameworkHints.next.nextFontPreloads || []) add(u, 'font', 'next/font');
    return Array.from(refs.values()).filter((r) => kindAllowed(r.kind, opts));
  }
  async function fetchAsset(ref, opts) {
    const existing = state.assets.get(ref.url);
    if (existing) return existing;
    const entry = { url: ref.url, kind: ref.kind, from: ref.from, status: 'pending', optimizedFrom: ref.optimizedFrom };
    state.assets.set(ref.url, entry);
    try {
      if (ref.url.startsWith('data:')) {
        const blob = await (await fetch(ref.url)).blob();
        entry.type = blob.type; entry.size = blob.size;
        const ext = EXT_BY_TYPE[blob.type] || '';
        entry.path = `assets/_inline/${hashStr(ref.url)}${ext}`;
        entry.blob = blob; entry.status = 'ok';
      } else {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60000);
        const res = await fetch(ref.url, { credentials: 'include', signal: ctrl.signal, redirect: 'follow' });
        clearTimeout(timer);
        entry.httpStatus = res.status;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const len = parseInt(res.headers.get('content-length') || '0', 10);
        if (len > opts.assetMaxBytes) { entry.status = 'skipped'; entry.error = `파일당 상한 초과 (${fmtBytes(len)})`; return entry; }
        const blob = await res.blob();
        if (blob.size > opts.assetMaxBytes) { entry.status = 'skipped'; entry.error = `파일당 상한 초과 (${fmtBytes(blob.size)})`; return entry; }
        if (state.assetBytes + blob.size > opts.assetTotalBytes) { entry.status = 'skipped'; entry.error = '총 용량 상한 초과'; return entry; }
        entry.type = (res.headers.get('content-type') || blob.type || '').split(';')[0].trim();
        entry.size = blob.size; entry.blob = blob; entry.finalUrl = res.url !== ref.url ? res.url : undefined;
        let path = assetPathFor(ref.url, entry.type);
        // path collision → suffix
        for (const other of state.assets.values()) { if (other !== entry && other.path === path) { const m = path.match(/^(.*?)(\.[a-z0-9]{1,5})?$/i); path = `${m[1]}__${hashStr(ref.url)}${m[2] || ''}`; break; } }
        entry.path = path; entry.status = 'ok';
        state.assetBytes += blob.size; state.assetCount++;
        if (entry.kind === 'css' || /text\/css/.test(entry.type)) entry.cssRefs = await extractCssRefs(blob, res.url || ref.url);
      }
    } catch (e) {
      entry.status = 'error'; entry.error = String(e && e.message || e);
    }
    return entry;
  }
  async function extractCssRefs(blob, baseUrl) {
    try {
      const text = await blob.text();
      const out = new Map();
      const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/g;
      let m;
      while ((m = re.exec(text))) { const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim(); if (!raw || raw.startsWith('#') || raw.startsWith('data:')) continue; try { const u = new URL(raw, baseUrl).href; if (!out.has(u)) out.set(u, kindFromUrl(u, /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(u) ? 'font' : undefined)); } catch { /* ignore */ } }
      const ire = /@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?/g;
      while ((m = ire.exec(text))) { try { const u = new URL(m[1], baseUrl).href; out.set(u, 'css'); } catch { /* ignore */ } }
      return Array.from(out, ([url, kind]) => ({ url, kind: kind === 'other' ? 'image' : kind }));
    } catch { return []; }
  }
  async function downloadAssets(cap, opts) {
    const refs = collectAssetRefs(cap, opts);
    const queue = refs.slice();
    const seen = new Set(refs.map((r) => r.url));
    const results = [];
    let done = 0;
    log(`에셋 다운로드 시작: ${queue.length}개 (이미지/폰트/CSS/JS…)`);
    const worker = async () => {
      while (queue.length) {
        checkStop();
        const ref = queue.shift();
        const entry = await fetchAsset(ref, opts);
        results.push({ url: ref.url, kind: ref.kind, from: ref.from, path: entry.path, size: entry.size, type: entry.type, status: entry.status, error: entry.error, optimizedFrom: ref.optimizedFrom });
        done++;
        if (done % 10 === 0 || !queue.length) { setStatus(`에셋 다운로드 ${done}/${done + queue.length} (${fmtBytes(state.assetBytes)})`, 'running'); setProgress(done / (done + queue.length)); }
        if (entry.cssRefs && entry.cssRefs.length) {
          for (const r of entry.cssRefs) { if (!seen.has(r.url) && kindAllowed(r.kind, opts)) { seen.add(r.url); queue.push({ url: r.url, kind: r.kind, from: `css url() in ${ref.url}` }); } }
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const ok = results.filter((r) => r.status === 'ok').length;
    log(`에셋 다운로드 완료: 성공 ${ok}/${results.length}, 누적 ${fmtBytes(state.assetBytes)}`, ok === results.length ? 'ok' : 'warn');
    return results;
  }

  // ------------------------------------------------------------------ Next.js manifests
  function decodeJsString(s) { return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, '/'); }
  // Extract the body of the JS array literal that follows `key` (bracket-matched, string-aware) and return its string items.
  function jsArrayStrings(src, key) {
    const i = src.indexOf(key);
    if (i < 0) return null;
    const start = src.indexOf('[', i);
    if (start < 0) return null;
    let depth = 0, inStr = null, esc = false, end = -1;
    for (let j = start; j < src.length; j++) {
      const ch = src[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
      if (ch === '"' || ch === "'") { inStr = ch; continue; }
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) return null;
    const body = src.slice(start + 1, end);
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = re.exec(body))) out.push(decodeJsString(m[1] ?? m[2]));
    return out;
  }
  async function fetchNextManifests(origin, buildId) {
    const out = { buildId };
    const grab = async (url) => { try { const r = await fetch(url, { credentials: 'include' }); if (!r.ok) return null; return await r.text(); } catch { return null; } };
    const bm = await grab(`${origin}/_next/static/${buildId}/_buildManifest.js`);
    if (bm) {
      out.buildManifestRaw = bm.slice(0, 200000);
      const pages = jsArrayStrings(bm, 'sortedPages');
      if (pages) out.sortedPages = pages;
    }
    const sm = await grab(`${origin}/_next/static/${buildId}/_ssgManifest.js`);
    if (sm) { const pages = jsArrayStrings(sm, 'new Set('); if (pages) out.ssgPages = pages; }
    return out;
  }

  // ------------------------------------------------------------------ bundle signature scan (downloaded JS/CSS)
  const BUNDLE_SIGNATURES = [
    ['react-dom', /reconcilerVersion:\s*"([^"]+)"/, 'version'],
    ['next.js', /\/_next\/static\/chunks\/(app|pages)\//, null],
    ['framer-motion', /whileInView|whileHover|AnimatePresence|useMotionValue/, null],
    ['@radix-ui', /data-radix-collection-item|radix-ui|RadixTooltip/, null],
    ['@headlessui', /headlessui/, null],
    ['swiper', /swiper-slide|swiper-wrapper/, null],
    ['embla-carousel', /embla__|emblaCarousel|embla-carousel/i, null],
    ['gsap', /ScrollTrigger|gsap\.registerPlugin|_gsap/, null],
    ['lenis', /lenis|Lenis\(/, null],
    ['three.js', /WebGLRenderer|THREE\.REVISION/, null],
    ['@react-three/fiber', /react-three|useFrame\(/, null],
    ['lottie', /lottie|bodymovin/i, null],
    ['@tanstack/react-query', /QueryClient|queryKeyHashFn|useQuery\(/, null],
    ['swr', /useSWR|swr\/|revalidateOnFocus/, null],
    ['zustand', /zustand|useSyncExternalStoreWithSelector/, null],
    ['redux', /@@redux|createSlice|configureStore/, null],
    ['jotai', /jotai/, null],
    ['react-hook-form', /shouldUnregister|useFormContext|react-hook-form/, null],
    ['zod', /ZodError|zod/, null],
    ['axios', /isAxiosError|axios/, null],
    ['lodash', /lodash/, null],
    ['dayjs', /dayjs/, null],
    ['date-fns', /date-fns/, null],
    ['i18next / next-intl', /i18next|next-intl/, null],
    ['next-auth', /next-auth|\/api\/auth\/session/, null],
    ['@clerk', /clerk\.com|clerk\./, null],
    ['supabase', /supabase/, null],
    ['firebase', /firebaseapp\.com|firebase/, null],
    ['prisma / trpc', /trpc|@prisma/, null],
    ['stripe', /js\.stripe\.com|Stripe\(/, null],
    ['tosspayments', /tosspayments|TossPayments/, null],
    ['portone / iamport', /iamport|portone|IMP\.request_pay/, null],
    ['kakao sdk', /developers\.kakao\.com|Kakao\.init|kakao\.com\/sdk/, null],
    ['naver', /naver\.com|wcs\.naver|pstatic\.net/, null],
    ['channel.io', /channel\.io|ChannelIO/, null],
    ['google analytics / gtm', /googletagmanager\.com|gtag\(|google-analytics\.com/, null],
    ['meta pixel', /connect\.facebook\.net|fbq\(/, null],
    ['hotjar', /hotjar/, null],
    ['mixpanel / amplitude / posthog', /mixpanel|amplitude|posthog/, null],
    ['sentry', /sentry\.io|@sentry|Sentry\./, null],
    ['vercel analytics', /va\.vercel-scripts\.com|\/_vercel\/insights|\/_vercel\/speed-insights/, null],
    ['openai', /api\.openai\.com/, null],
    ['replicate / fal / stability', /replicate\.com|fal\.ai|fal\.run|stability\.ai/, null],
    ['sanity / contentful / prismic / strapi', /sanity\.io|cdn\.sanity|contentful|prismic\.io|strapi/, null],
    ['shopify / cafe24 / imweb', /myshopify|shopify|cafe24|imweb/, null],
    ['lucide icons', /lucide-react|lucide lucide-/, null],
    ['react-icons', /react-icons/, null],
    ['tailwindcss', /--tw-|tailwindcss/, null],
    ['emotion', /data-emotion|@emotion/, null],
    ['styled-components', /data-styled|styled-components/, null],
    ['mapbox / google maps', /mapbox|maps\.googleapis\.com/, null],
  ];
  async function scanBundleSignatures(cap) {
    const found = {};
    const jsAssets = (cap.assetRefs || []).filter((r) => r.status === 'ok' && (r.kind === 'js' || r.kind === 'css'));
    for (const ref of jsAssets) {
      const entry = state.assets.get(ref.url);
      if (!entry || !entry.blob || entry.blob.size > 8 * 1048576) continue;
      let text;
      try { text = await entry.blob.text(); } catch { continue; }
      const file = ref.url.split('/').pop().split('?')[0] || ref.url;
      for (const [name, re, capture] of BUNDLE_SIGNATURES) {
        const m = text.match(re);
        if (!m) continue;
        const rec = found[name] || (found[name] = { files: [] });
        if (rec.files.length < 8 && !rec.files.includes(file)) rec.files.push(file);
        if (capture && m[1]) rec[capture] = m[1];
      }
    }
    return found;
  }

  // ------------------------------------------------------------------ capture pipeline
  function slugFor(url) {
    const u = new URL(url);
    let s = u.pathname.replace(/^\/+|\/+$/g, '');
    s = s ? s.replace(/\//g, '__').replace(/[^\w.-]+/g, '-').slice(0, 80) : 'index';
    if (u.search) s += `__q${hashStr(u.search)}`;
    let base = s, i = 2;
    while (state.captures.some((c) => c.slug === s)) s = `${base}-${i++}`;
    return s;
  }
  async function capturePage(tabId, windowId, opts, { skipHookReload = false } = {}) {
    const t0 = Date.now();
    const tab = await chrome.tabs.get(tabId);
    if (!/^https?:/i.test(tab.url || '')) throw new Error('http/https 페이지가 아닙니다');
    const url0 = tab.url;
    const origin = new URL(url0).origin;
    state.siteHost = state.siteHost || new URL(url0).host;
    setStatus(`캡처 중: ${url0}`, 'running'); setProgress(0);
    log(`== 캡처 시작: ${url0}`);
    await chrome.tabs.update(tabId, { active: true });
    try { await chrome.windows.update(windowId, { focused: true }); } catch { /* ignore */ }

    await ensureCollector(tabId);
    // "record from page load": register the MAIN-world hook at document_start for this origin, then reload once
    // so the initial data fetches (API calls, RSC payloads) are captured too.
    if (opts.hookFromLoad && !skipHookReload) {
      await registerHookForOrigin(origin);
      log('로드 시점 기록을 위해 페이지를 새로고침합니다…');
      await reloadTab(tabId, opts);
      await ensureCollector(tabId);
    }
    const hookOk = opts.react || opts.network ? await ensureHook(tabId) : false;
    const vpBase = await sendToTab(tabId, { cmd: 'viewport' });
    if (!hookOk && (opts.react || opts.network)) log('MAIN 훅을 설치하지 못했습니다 (CSP 또는 페이지 제한). React/네트워크 데이터는 생략됩니다.', 'warn');
    const idle = await sendToTab(tabId, { cmd: 'waitIdle', maxMs: 10000 });
    log(`페이지 안정화: readyState=${idle.readyState}, 리소스 ${idle.resources}개, ${idle.waitedMs}ms`);
    if (opts.scrollFirst) { const s = await sendToTab(tabId, { cmd: 'scrollThrough' }); log(`지연 로딩 유도 스크롤 완료 (${s.height}px, ${s.ms}ms)`); await sendToTab(tabId, { cmd: 'waitIdle', maxMs: 4000, quietMs: 500 }); }
    checkStop();

    const cap = { url: url0, slug: slugFor(url0), startedAt: new Date(t0).toISOString(), screenshots: {}, assetRefs: [] };
    // screenshots (before DOM collection so lazy content is loaded; DOM collected in the natural state)
    if (opts.screenshot) {
      try { cap.screenshots.full = await fullPageScreenshot(tabId, windowId, opts, '기본'); log(`전체 스크린샷: ${cap.screenshots.full.width}×${cap.screenshots.full.height}px (${fmtBytes(cap.screenshots.full.blob.size)})`, 'ok'); }
      catch (e) { if (state.stop) throw e; log(`스크린샷 실패: ${e.message}`, 'err'); }
      if (opts.responsive && opts.widths.length) {
        cap.screenshots.responsive = {};
        for (const w of opts.widths) {
          checkStop();
          try {
            const shot = await withViewportWidth(tabId, windowId, w, (actual) => fullPageScreenshot(tabId, windowId, opts, `${actual}px`));
            cap.screenshots.responsive[shot.cssWidth] = shot;
            log(`반응형 스크린샷 ${shot.cssWidth}px: ${shot.width}×${shot.height}`, 'ok');
          } catch (e) { if (state.stop) throw e; log(`반응형 스크린샷(${w}px) 실패: ${e.message}`, 'err'); }
        }
        // Make sure the DOM/style collection below happens at the original viewport width.
        const restored = await ensureViewportWidth(tabId, windowId, vpBase.innerWidth);
        if (Math.abs(restored - vpBase.innerWidth) > 2) log(`주의: 수집 뷰포트가 ${restored}px 입니다 (원래 ${vpBase.innerWidth}px)`, 'warn');
        await sendToTab(tabId, { cmd: 'waitIdle', maxMs: 3000, quietMs: 400 });
      }
    }
    checkStop();
    // DOM / styles / everything
    setStatus('DOM·스타일·에셋 정보 수집 중…', 'running'); setProgress(0.2);
    const manifest = await sendToTab(tabId, { cmd: 'collect', opts: { styles: opts.styles, maxStyledElements: opts.maxStyledElements, react: opts.react && hookOk, network: opts.network && hookOk, storageValues: opts.storageValues } }, { timeoutMs: 300000 });
    log(`수집 완료 (${manifest.timings.total}ms): ${Object.entries(manifest.parts).map(([k, v]) => `${k} ${fmtBytes(v)}`).join(', ')}`);
    const data = await fetchPart(tabId, 'core');
    for (const name of ['html', 'elements', 'styles', 'assets', 'scripts', 'hook']) data[name] = await fetchPart(tabId, name);
    await sendToTab(tabId, { cmd: 'releaseParts' }).catch(() => {});
    cap.data = data;
    cap.title = data.meta.title;
    setProgress(0.5);
    // Next.js manifests
    const buildId = (data.frameworkHints && data.frameworkHints.next && data.frameworkHints.next.buildId) || (data.hook && data.hook.detect && data.hook.detect.next && data.hook.detect.next.buildId);
    if (buildId) { cap.next = await fetchNextManifests(origin, buildId); if (cap.next.sortedPages) log(`Next.js 빌드 매니페스트: 라우트 ${cap.next.sortedPages.length}개`); }
    // section crops (rects come from the collected layout, so the screenshot must have the same viewport width)
    if (opts.screenshot && opts.sections && cap.screenshots.full) {
      const collectWidth = data.meta.viewport.innerWidth;
      let source = cap.screenshots.full;
      if (Math.abs(source.cssWidth - collectWidth) > 2) source = Object.values(cap.screenshots.responsive || {}).find((s) => Math.abs(s.cssWidth - collectWidth) <= 2) || null;
      if (!source) log(`섹션 크롭 생략: 수집 뷰포트(${collectWidth}px)와 일치하는 스크린샷이 없습니다`, 'warn');
      else {
        try { cap.screenshots.sections = await cropSections(source, data.structure.sections, opts); log(`섹션 스크린샷 ${cap.screenshots.sections.length}개 (${source.cssWidth}px 기준)`); }
        catch (e) { log(`섹션 크롭 실패: ${e.message}`, 'warn'); }
      }
    }
    // assets
    if (opts.assets) {
      try { cap.assetRefs = await downloadAssets(cap, opts); } catch (e) { if (state.stop) throw e; log(`에셋 다운로드 오류: ${e.message}`, 'err'); }
      try {
        cap.bundle = await scanBundleSignatures(cap);
        const names = Object.keys(cap.bundle);
        if (names.length) log(`번들 시그니처: ${names.map((n) => (cap.bundle[n].version ? `${n} ${cap.bundle[n].version}` : n)).join(', ')}`);
      } catch (e) { log(`번들 스캔 오류: ${e.message}`, 'warn'); }
    }
    cap.ms = Date.now() - t0;
    state.captures.push(cap);
    log(`== 캡처 완료: ${cap.slug} (${(cap.ms / 1000).toFixed(1)}s, 요소 ${data.meta.elementCount}, 스타일 ${data.elementStats.styled}, React ${data.hook && data.hook.react ? data.hook.react.nodeCount + ' nodes' : '없음'}, 네트워크 ${data.hook && data.hook.network ? data.hook.network.requests.length : 0}건)`, 'ok');
    renderPages(); selectCapture(cap); updateButtons();
    setProgress(1);
    return cap;
  }

  // ------------------------------------------------------------------ crawl
  function normalizeUrl(u) { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return null; } }
  function crawlable(url, origin, opts) {
    try {
      const u = new URL(url);
      if (u.origin !== origin) return false;
      if (/\.(png|jpe?g|gif|svg|webp|avif|ico|pdf|zip|mp4|webm|mp3|css|js|json|xml|txt|woff2?|ttf|map)$/i.test(u.pathname)) return false;
      if (/^\/(_next|api|_vercel)\//.test(u.pathname)) return false;
      if (opts.pathPrefix && !u.pathname.startsWith(opts.pathPrefix)) return false;
      return true;
    } catch { return false; }
  }
  async function crawlSite(tabId, windowId, opts) {
    const tab = await chrome.tabs.get(tabId);
    const start = normalizeUrl(tab.url);
    const origin = new URL(start).origin;
    const queue = [start];
    const seen = new Set(queue);
    const skipped = [];
    state.sitemap = { origin, captured: [], pending: [], skipped };
    if (opts.hookFromLoad) await registerHookForOrigin(origin);
    let first = true;
    while (queue.length && state.captures.length < opts.maxPages) {
      checkStop();
      const url = queue.shift();
      try {
        if (!first || normalizeUrl((await chrome.tabs.get(tabId)).url) !== url) { log(`이동: ${url}`); await navigateTab(tabId, url, opts); }
        const cap = await capturePage(tabId, windowId, opts, { skipHookReload: !first || !opts.hookFromLoad ? true : false });
        state.sitemap.captured.push(url);
        const found = [];
        for (const u of cap.data.links.internalUrls || []) { const n = normalizeUrl(u); if (n && !seen.has(n)) { if (crawlable(n, origin, opts)) { seen.add(n); queue.push(n); found.push(n); } else { seen.add(n); skipped.push(n); } } }
        if (opts.useManifest && cap.next && cap.next.sortedPages) {
          for (const p of cap.next.sortedPages) { if (/^\/_(app|error|document)$/.test(p) || /\[.*\]/.test(p) || /^\/(404|500)$/.test(p)) continue; const n = normalizeUrl(origin + p); if (n && !seen.has(n) && crawlable(n, origin, opts)) { seen.add(n); queue.push(n); found.push(n); } }
        }
        log(`새 내부 URL ${found.length}개 발견, 대기열 ${queue.length}`);
      } catch (e) {
        if (state.stop) throw e;
        log(`페이지 실패 ${url}: ${e.message}`, 'err');
        skipped.push(`${url} (오류: ${e.message})`);
      }
      first = false;
      state.sitemap.pending = queue.slice();
    }
    state.sitemap.pending = queue.slice();
    log(`크롤 종료: ${state.sitemap.captured.length}페이지 캡처, 대기 ${queue.length}, 건너뜀 ${skipped.length}`, 'ok');
  }

  // ------------------------------------------------------------------ ZIP export
  function stripForJson(cap) {
    // JSON-only export: everything except blobs
    const { data } = cap;
    return { url: cap.url, slug: cap.slug, title: cap.title, startedAt: cap.startedAt, ms: cap.ms, next: cap.next, assetRefs: cap.assetRefs, screenshots: Object.fromEntries(Object.entries(cap.screenshots || {}).map(([k, v]) => [k, k === 'responsive' ? Object.fromEntries(Object.entries(v).map(([w, s]) => [w, { width: s.width, height: s.height, cssWidth: s.cssWidth, cssHeight: s.cssHeight }])) : k === 'sections' ? v.map((s) => ({ name: s.name, rect: s.rect })) : { width: v.width, height: v.height, cssWidth: v.cssWidth, cssHeight: v.cssHeight }])), data };
  }
  async function buildZip() {
    const zip = new ZipWriter();
    const host = (state.siteHost || 'site').replace(/[^\w.-]/g, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const root = `${host}_${stamp}`;
    const add = (name, content, opts) => zip.add(`${root}/${name}`, content, opts);
    let n = 0;
    const totalSteps = state.captures.length + 2;
    for (const cap of state.captures) {
      setStatus(`ZIP 생성 중: ${cap.slug}`, 'running'); setProgress(++n / totalSteps);
      const d = cap.data;
      const base = `pages/${cap.slug}`;
      const core = { ...d };
      for (const k of ['html', 'elements', 'styles', 'assets', 'scripts', 'hook', 'performance']) delete core[k];
      core.url = cap.url; core.slug = cap.slug; core.next = cap.next; core.captureMs = cap.ms;
      await add(`${base}/report.md`, SCReport.buildPageReport(cap));
      await add(`${base}/page.html`, d.html || '');
      await add(`${base}/dom-outline.txt`, SCReport.domOutline(d));
      await add(`${base}/page.json`, JSON.stringify(core, null, 1));
      await add(`${base}/elements.json`, JSON.stringify(d.elements || [], null, 0));
      await add(`${base}/assets.json`, JSON.stringify({ ...(d.assets || {}), svgs: (d.assets && d.assets.svgs || []).map((s) => ({ ...s, outerHTML: undefined, file: `svg/${s.hash}.svg` })), canvases: (d.assets && d.assets.canvases || []).map((c) => ({ ...c, dataUrl: undefined, file: c.dataUrl ? `canvas/${c.id}.png` : undefined })), downloaded: cap.assetRefs }, null, 1));
      await add(`${base}/scripts.json`, JSON.stringify(d.scripts || [], null, 1));
      await add(`${base}/performance.json`, JSON.stringify(d.performance || {}, null, 1));
      // styles
      const st = d.styles || {};
      const sheetIndex = (st.sheets || []).map((s) => ({ ...s, cssText: undefined, inlineText: undefined, file: s.cssText != null ? `styles/sheet-${String(s.index).padStart(3, '0')}.css` : undefined, inlineFile: s.inlineText ? `styles/inline-${String(s.index).padStart(3, '0')}.css` : undefined }));
      await add(`${base}/styles/stylesheets.json`, JSON.stringify(sheetIndex, null, 1));
      for (const s of st.sheets || []) {
        const header = `/* sheet #${s.index} origin=${s.origin} href=${s.href || '(inline)'} media=${s.media || ''} rules=${s.ruleCount} */\n`;
        if (s.cssText != null) await add(`${base}/styles/sheet-${String(s.index).padStart(3, '0')}.css`, header + s.cssText);
        if (s.inlineText) await add(`${base}/styles/inline-${String(s.index).padStart(3, '0')}.css`, header + s.inlineText);
      }
      await add(`${base}/styles/fontfaces.json`, JSON.stringify({ fontFaces: st.fontFaces || [], loaded: (d.fonts && d.fonts.loaded) || [] }, null, 1));
      await add(`${base}/styles/keyframes.css`, (st.keyframes || []).map((k) => k.css).join('\n\n'));
      await add(`${base}/styles/state-rules.json`, JSON.stringify(st.stateRules || [], null, 1));
      await add(`${base}/styles/tokens.json`, JSON.stringify(d.tokens || {}, null, 1));
      await add(`${base}/styles/custom-properties.json`, JSON.stringify({ rootComputed: st.rootVars || {}, declarations: st.customProps || {}, propertyRules: st.propertyRules || [] }, null, 1));
      await add(`${base}/styles/media-queries.json`, JSON.stringify({ mediaQueries: st.mediaQueries || [], breakpoints: st.breakpoints || [], containerQueries: st.containerQueries || [], layers: st.layers || [], imports: st.imports || [] }, null, 1));
      // framework
      const hk = d.hook || {};
      await add(`${base}/framework/detect.json`, JSON.stringify({ hints: d.frameworkHints || {}, detect: hk.detect || null, hookPresent: !!hk.present, errors: { detect: hk.detectError, react: hk.reactError, network: hk.networkError, flight: hk.flightError } }, null, 1));
      if (hk.react) { await add(`${base}/framework/react-tree.json`, JSON.stringify(hk.react, null, 0)); await add(`${base}/framework/react-tree.txt`, SCReport.reactTreeText(hk.react.roots)); await add(`${base}/framework/react-components.json`, JSON.stringify(hk.react.components || [], null, 1)); }
      if (d.frameworkHints && d.frameworkHints.next && d.frameworkHints.next.nextData) await add(`${base}/framework/next-data.json`, JSON.stringify(d.frameworkHints.next.nextData, null, 1));
      if (hk.flight && hk.flight.present) { await add(`${base}/framework/rsc-flight.txt`, hk.flight.text || ''); if (hk.flight.nextData) await add(`${base}/framework/next-data-full.json`, hk.flight.nextData); }
      if (hk.console && hk.console.errors && hk.console.errors.length) await add(`${base}/framework/console-errors.json`, JSON.stringify(hk.console.errors, null, 1));
      if (cap.next) await add(`${base}/framework/build-manifest.json`, JSON.stringify(cap.next, null, 1));
      if (cap.bundle) await add(`${base}/framework/bundle-signatures.json`, JSON.stringify(cap.bundle, null, 1));
      await add(`${base}/network.json`, JSON.stringify(hk.network || { note: 'hook not installed' }, null, 1));
      // svg / canvas
      const seenSvg = new Set();
      for (const s of (d.assets && d.assets.svgs) || []) { if (seenSvg.has(s.hash)) continue; seenSvg.add(s.hash); await add(`${base}/svg/${s.hash}.svg`, s.outerHTML.includes('xmlns=') ? s.outerHTML : s.outerHTML.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')); }
      for (const c of (d.assets && d.assets.canvases) || []) if (c.dataUrl) { try { await add(`${base}/canvas/${c.id}.png`, await (await fetch(c.dataUrl)).blob()); } catch { /* ignore */ } }
      // screenshots
      const sh = cap.screenshots || {};
      if (sh.full) await add(`${base}/screenshots/full-${sh.full.cssWidth}.${sh.full.format}`, sh.full.blob);
      for (const [w, s] of Object.entries(sh.responsive || {})) await add(`${base}/screenshots/full-${w}.${s.format}`, s.blob);
      for (const s of sh.sections || []) await add(`${base}/screenshots/sections/${s.name}.${s.format}`, s.blob);
      if (sh.sections) await add(`${base}/screenshots/sections/index.json`, JSON.stringify(sh.sections.map((s) => ({ file: `${s.name}.${s.format}`, rect: s.rect, label: s.label, path: s.path })), null, 1));
    }
    // shared assets
    setStatus('ZIP 생성 중: 에셋', 'running'); setProgress(++n / totalSteps);
    const manifest = [];
    for (const a of state.assets.values()) {
      manifest.push({ url: a.url, path: a.path, kind: a.kind, type: a.type, size: a.size, status: a.status, error: a.error, from: a.from, optimizedFrom: a.optimizedFrom, finalUrl: a.finalUrl });
      if (a.status === 'ok' && a.blob && a.path && !zip.has(`${root}/${a.path}`)) await add(a.path, a.blob);
    }
    await add('assets/manifest.json', JSON.stringify(manifest, null, 1));
    await add('sitemap.json', JSON.stringify(state.sitemap || { captured: state.captures.map((c) => c.url) }, null, 1));
    await add('README.md', SCReport.rootReadme(state));
    await add('log.txt', state.log.map((l) => `[${l.t}] ${l.msg}`).join('\n'));
    setStatus('ZIP 압축 마무리 중…', 'running');
    const blob = await zip.finish();
    return { blob, name: `${root}.zip`, entries: zip.entries.length };
  }
  async function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    try {
      const id = await chrome.downloads.download({ url, filename: `site-clone/${filename}`, saveAs: false, conflictAction: 'uniquify' });
      const onChanged = (delta) => { if (delta.id === id && delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) { chrome.downloads.onChanged.removeListener(onChanged); setTimeout(() => URL.revokeObjectURL(url), 5000); } };
      chrome.downloads.onChanged.addListener(onChanged);
      return id;
    } catch (e) {
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return null;
    }
  }

  // ------------------------------------------------------------------ UI rendering
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null) el.setAttribute(k, v); }
    for (const c of children.flat()) if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
  }
  function table(headers, rows) {
    return h('table', null, h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', { class: typeof c === 'number' ? 'num' : '' }, c == null ? '' : String(c)))))));
  }
  function renderPages() {
    $('pageCount').textContent = String(state.captures.length);
    const wrap = $('pages');
    wrap.innerHTML = '';
    for (const cap of state.captures) {
      wrap.appendChild(h('div', { class: `page${state.selected === cap ? ' active' : ''}`, onclick: () => selectCapture(cap) },
        h('div', null, h('div', { class: 't' }, cap.title || '(제목 없음)'), h('div', { class: 'u' }, cap.url)),
        h('div', { class: 'm' }, `${cap.data.meta.elementCount} 요소 · ${(cap.ms / 1000).toFixed(1)}s · ${cap.assetRefs.filter((r) => r.status === 'ok').length} 에셋`)));
    }
  }
  function selectCapture(cap) {
    state.selected = cap;
    renderPages();
    renderSummary(cap); renderTokens(cap); renderShots(cap); renderAssets(cap); renderNetwork(cap); renderReact(cap); renderReport(cap);
  }
  function kv(pairs) { return h('div', { class: 'kv' }, pairs.flatMap(([k, v]) => [h('div', { class: 'k' }, k), h('div', { class: 'v' }, v == null ? '-' : String(v))])); }
  function renderSummary(cap) {
    const d = cap.data; const s = SCReport.stackSummary(d, cap);
    const el = $('summary'); el.innerHTML = '';
    el.appendChild(h('h3', null, '페이지'));
    el.appendChild(kv([['URL', cap.url], ['제목', d.meta.title], ['뷰포트', `${d.meta.viewport.innerWidth}×${d.meta.viewport.innerHeight} @${d.meta.viewport.devicePixelRatio}x`], ['문서 크기', `${d.meta.document.scrollWidth}×${d.meta.document.scrollHeight}`], ['요소 수', `${d.meta.elementCount} (스타일 ${d.elementStats.styled})`], ['수집 시간', `${d.timings.total} ms (snapshot ${d.timings.snapshot}, elements ${d.timings.elements}, styles ${d.timings.styles}, hook ${d.timings.hook})`], ['언어', d.meta.lang || '-']]));
    el.appendChild(h('h3', null, '기술 스택'));
    el.appendChild(h('div', { class: 'chips' }, [...s.framework, ...s.ui].map((x) => h('span', { class: 'chip on' }, x)), ...Object.keys(s.analytics).map((x) => h('span', { class: 'chip' }, x)), ...s.bundle.map((x) => h('span', { class: 'chip', title: '번들 시그니처' }, `⌘ ${x}`))));
    if (!s.framework.length && !s.ui.length) el.appendChild(h('div', null, '프레임워크 특징이 감지되지 않았습니다.'));
    const rt = d.hook && d.hook.react;
    el.appendChild(h('h3', null, 'React'));
    el.appendChild(kv([['훅 설치', d.hook && d.hook.present ? '예' : '아니오'], ['파이버 노드', rt ? rt.nodeCount : '-'], ['컴포넌트 종류', rt ? rt.components.length : '-'], ['상위 컴포넌트', rt ? rt.components.slice(0, 12).map((c) => `${c.name}(${c.count})`).join(', ') : '-']]));
    el.appendChild(h('h3', null, '구조'));
    el.appendChild(table(['태그', 'label', '크기', '선택자'], d.structure.landmarks.slice(0, 40).map((x) => [x.tag, x.label || x.role || '', `${Math.round(x.rect.w)}×${Math.round(x.rect.h)}`, x.path])));
    el.appendChild(h('h3', null, '헤딩'));
    el.appendChild(h('pre', { class: 'mono' }, d.structure.headings.slice(0, 80).map((x) => `${'  '.repeat(x.level - 1)}h${x.level} ${x.text}`).join('\n') || '(없음)'));
    el.appendChild(h('h3', null, '링크'));
    el.appendChild(kv([['내부 URL', (d.links.internalUrls || []).length], ['종류별', Object.entries(d.links.counts).map(([k, v]) => `${k} ${v}`).join(', ')]]));
    if (cap.next && cap.next.sortedPages) el.appendChild(kv([['Next.js 라우트', cap.next.sortedPages.join(', ')]]));
  }
  function renderTokens(cap) {
    const t = cap.data.tokens; const el = $('tokens'); el.innerHTML = '';
    el.appendChild(h('h3', null, `색상 (${t.colors.length})`));
    el.appendChild(h('div', { class: 'swatches' }, t.colors.slice(0, 48).map((c) => h('span', { class: 'swatch', title: (c.uses || []).join(' ') }, h('i', { style: `background:${c.value}` }), `${c.value} ×${c.count}`))));
    el.appendChild(h('h3', null, '폰트')); el.appendChild(table(['family', '횟수'], t.fontFamilies.map((x) => [x.value, x.count])));
    el.appendChild(h('div', null, `크기: ${t.fontSizes.map((x) => `${x.value}(${x.count})`).join(', ')}`));
    el.appendChild(h('div', null, `굵기: ${t.fontWeights.map((x) => `${x.value}(${x.count})`).join(', ')}`));
    el.appendChild(h('h3', null, '간격 · 형태'));
    el.appendChild(kv([['radius', t.radii.map((x) => `${x.value}(${x.count})`).join(', ')], ['gap', t.gaps.map((x) => `${x.value}(${x.count})`).join(', ')], ['padding', t.paddings.slice(0, 14).map((x) => `${x.value}(${x.count})`).join(', ')], ['max-width', t.maxWidths.map((x) => `${x.value}(${x.count})`).join(', ')], ['z-index', t.zIndexes.map((x) => `${x.value}(${x.count})`).join(', ')], ['breakpoints', (cap.data.styles.breakpoints || []).join(', ')]]));
    el.appendChild(h('h3', null, '그림자')); el.appendChild(h('pre', { class: 'mono' }, t.shadows.map((x) => `${x.value}  ×${x.count}`).join('\n') || '(없음)'));
    el.appendChild(h('h3', null, '그라디언트')); el.appendChild(h('pre', { class: 'mono' }, t.gradients.map((x) => `${x.value}  ×${x.count}`).join('\n') || '(없음)'));
    const vars = Object.entries(cap.data.styles.rootVars || {});
    el.appendChild(h('h3', null, `CSS 변수 (${vars.length})`)); el.appendChild(table(['변수', '값'], vars.slice(0, 200).map(([k, v]) => [k, v])));
    const ff = cap.data.styles.fontFaces || [];
    el.appendChild(h('h3', null, `@font-face (${ff.length})`)); el.appendChild(table(['family', 'weight', 'style', 'src'], ff.slice(0, 60).map((f) => [f.family, f.weight || '', f.style || '', (f.srcUrls || []).slice(0, 1).join('')])));
  }
  const objectUrls = [];
  function renderShots(cap) {
    const el = $('shots'); el.innerHTML = '';
    for (const u of objectUrls.splice(0)) URL.revokeObjectURL(u);
    const sh = cap.screenshots || {};
    const show = (label, s) => { const u = URL.createObjectURL(s.blob); objectUrls.push(u); el.appendChild(h('div', { class: 'cap' }, `${label}: ${s.width}×${s.height}px (${fmtBytes(s.blob.size)}, ${s.frames || 1}프레임)`)); el.appendChild(h('img', { src: u, alt: label })); };
    if (sh.full) show(`전체 (${sh.full.cssWidth}px)`, sh.full);
    for (const [w, s] of Object.entries(sh.responsive || {})) show(`반응형 ${w}px`, s);
    if (sh.sections && sh.sections.length) { el.appendChild(h('h3', null, `섹션 (${sh.sections.length})`)); for (const s of sh.sections) { const u = URL.createObjectURL(s.blob); objectUrls.push(u); el.appendChild(h('div', { class: 'cap' }, `${s.name} ${s.label ? `— ${s.label}` : ''} (${Math.round(s.rect.w)}×${Math.round(s.rect.h)})`)); el.appendChild(h('img', { src: u, alt: s.name })); } }
    if (!sh.full) el.appendChild(h('div', null, '스크린샷 없음'));
  }
  function renderAssets(cap) {
    const el = $('assets'); el.innerHTML = '';
    const refs = cap.assetRefs || [];
    const byKind = {};
    for (const r of refs) { byKind[r.kind] = byKind[r.kind] || { n: 0, ok: 0, bytes: 0 }; byKind[r.kind].n++; if (r.status === 'ok') { byKind[r.kind].ok++; byKind[r.kind].bytes += r.size || 0; } }
    el.appendChild(h('h3', null, '다운로드 요약'));
    el.appendChild(table(['종류', '요청', '성공', '용량'], Object.entries(byKind).map(([k, v]) => [k, v.n, v.ok, fmtBytes(v.bytes)])));
    el.appendChild(h('h3', null, `파일 (${refs.length})`));
    el.appendChild(table(['상태', '종류', 'URL', '경로', '크기', '오류'], refs.slice(0, 600).map((r) => [r.status, r.kind, r.url, r.path || '', r.size != null ? fmtBytes(r.size) : '', r.error || ''])));
    const a = cap.data.assets;
    el.appendChild(h('h3', null, `페이지 이미지 (${a.images.length}) / SVG (${a.svgs.length}) / 배경 (${a.backgroundImages.length})`));
    el.appendChild(table(['img', 'alt', '표시', '원본', 'next/image 원본'], a.images.slice(0, 200).map((i) => [i.currentSrc || i.src, i.alt || '', `${Math.round(i.rect.w)}×${Math.round(i.rect.h)}`, `${i.naturalWidth}×${i.naturalHeight}`, i.originalSrc || ''])));
  }
  function renderNetwork(cap) {
    const el = $('network'); el.innerHTML = '';
    const net = cap.data.hook && cap.data.hook.network;
    if (!net) { el.appendChild(h('div', null, '네트워크 기록 없음 (훅 미설치 또는 옵션 꺼짐)')); }
    else {
      el.appendChild(h('h3', null, `fetch/XHR (${net.requests.length}) — ${new Date(net.since).toLocaleTimeString()} 이후`));
      el.appendChild(table(['시각(ms)', '종류', 'method', 'status', 'URL', 'content-type', '응답 크기', '소요'], net.requests.slice(0, 500).map((r) => [r.tRel, r.kind, r.method || '', r.status || r.error || '', r.url, (r.resHeaders && r.resHeaders['content-type']) || '', r.resSize != null ? fmtBytes(r.resSize) : '', r.duration != null ? `${r.duration}ms` : ''])));
      if (net.sockets.length) { el.appendChild(h('h3', null, 'WebSocket / EventSource')); el.appendChild(table(['종류', 'URL'], net.sockets.map((s) => [s.kind, s.url]))); }
    }
    const perf = cap.data.performance.resources || [];
    el.appendChild(h('h3', null, `리소스 타이밍 (${perf.length})`));
    el.appendChild(table(['initiator', 'URL', '전송', '소요'], perf.slice(0, 400).map((r) => [r.initiatorType, r.name, fmtBytes(r.transferSize), `${Math.round(r.duration)}ms`])));
  }
  function renderReact(cap) {
    const rt = cap.data.hook && cap.data.hook.react;
    $('react').textContent = rt ? SCReport.reactTreeText(rt.roots, { maxLines: 4000 }) : `(React 트리 없음${cap.data.hook && cap.data.hook.reactError ? ': ' + cap.data.hook.reactError : ''})`;
  }
  function renderReport(cap) { $('report').textContent = SCReport.buildPageReport(cap); }
  function updateButtons() {
    const has = state.captures.length > 0;
    $('btnZip').disabled = !has || state.running;
    $('btnJson').disabled = !has || state.running;
    $('btnCapture').disabled = state.running;
    $('btnCrawl').disabled = state.running;
    $('btnStop').disabled = !state.running;
  }

  // ------------------------------------------------------------------ actions
  async function run(fn, doneMsg) {
    if (state.running) return;
    state.running = true; state.stop = false; updateButtons();
    const opts = readOptions();
    await saveOptions();
    const tabId = state.targetTabId, windowId = state.targetWindowId;
    if (!tabId) { setStatus('대상 탭을 선택하세요', 'error'); state.running = false; updateButtons(); return; }
    try {
      await fn(tabId, windowId, opts);
      setStatus(doneMsg, 'done');
      try { await chrome.windows.update((await chrome.windows.getCurrent()).id, { focused: true }); } catch { /* ignore */ }
    } catch (e) {
      log(`오류: ${e && e.stack || e}`, 'err');
      setStatus(state.stop ? '중지됨' : `오류: ${e.message}`, 'error');
    } finally {
      try { await sendToTab(tabId, { cmd: 'shot:restore' }, { timeoutMs: 2000 }); } catch { /* ignore */ }
      state.running = false; updateButtons(); setProgress(0);
    }
  }
  window.SCD.capture = () => run(async (tabId, windowId, opts) => { await capturePage(tabId, windowId, opts); }, '캡처 완료 — ZIP 다운로드 가능');
  window.SCD.crawl = () => run(async (tabId, windowId, opts) => { await crawlSite(tabId, windowId, opts); }, '크롤 완료 — ZIP 다운로드 가능');
  window.SCD.buildZip = buildZip;
  window.SCD.readOptions = readOptions;
  window.SCD.exportJson = () => JSON.stringify({ version: VERSION, site: state.siteHost, sitemap: state.sitemap, captures: state.captures.map(stripForJson), assets: Array.from(state.assets.values()).map((a) => ({ ...a, blob: undefined, cssRefs: undefined })) });

  $('btnCapture').addEventListener('click', () => window.SCD.capture());
  $('btnCrawl').addEventListener('click', () => { $('optCrawl').checked = true; window.SCD.crawl(); });
  $('btnStop').addEventListener('click', () => { state.stop = true; log('중지 요청…', 'warn'); });
  $('btnZip').addEventListener('click', async () => {
    if (state.running) return;
    state.running = true; updateButtons();
    try { const { blob, name, entries } = await buildZip(); log(`ZIP 생성: ${name} (${entries}개 항목, ${fmtBytes(blob.size)})`, 'ok'); await downloadBlob(blob, name); setStatus(`ZIP 다운로드 시작: ${name}`, 'done'); }
    catch (e) { log(`ZIP 실패: ${e.stack || e}`, 'err'); setStatus(`ZIP 실패: ${e.message}`, 'error'); }
    finally { state.running = false; updateButtons(); setProgress(0); }
  });
  $('btnJson').addEventListener('click', async () => {
    const text = window.SCD.exportJson();
    const name = `${(state.siteHost || 'site').replace(/[^\w.-]/g, '_')}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    await downloadBlob(new Blob([text], { type: 'application/json' }), name);
    log(`JSON 다운로드: ${name} (${fmtBytes(text.length)})`, 'ok');
  });
  $('btnReset').addEventListener('click', async () => {
    if (state.running) return;
    state.captures = []; state.assets = new Map(); state.assetBytes = 0; state.assetCount = 0; state.sitemap = null; state.selected = null; state.siteHost = '';
    await unregisterHooks();
    renderPages(); for (const id of ['summary', 'tokens', 'shots', 'assets', 'network']) $(id).innerHTML = ''; $('react').textContent = ''; $('report').textContent = '';
    updateButtons(); setStatus('초기화됨'); log('상태를 초기화했습니다.');
  });
  $('refreshTabs').addEventListener('click', refreshTabs);
  $('tabSelect').addEventListener('change', (e) => { const o = e.target.selectedOptions[0]; if (o) selectTab(Number(o.value), Number(o.dataset.windowId)); });
  for (const b of $('resultTabs').querySelectorAll('button')) b.addEventListener('click', () => {
    for (const x of $('resultTabs').querySelectorAll('button')) x.classList.toggle('active', x === b);
    for (const p of document.querySelectorAll('.tabpane')) p.classList.toggle('active', p.dataset.pane === b.dataset.tab);
  });
  for (const id of OPT_IDS) $(id).addEventListener('change', saveOptions);
  window.addEventListener('beforeunload', () => { if (state.hookRegisteredOrigin) unregisterHooks(); });

  // ------------------------------------------------------------------ init
  (async () => {
    $('version').textContent = `v${VERSION}`;
    await loadOptions();
    const params = new URLSearchParams(location.search);
    const tabId = parseInt(params.get('tabId') || '', 10);
    const windowId = parseInt(params.get('windowId') || '', 10);
    if (tabId) { state.targetTabId = tabId; state.targetWindowId = windowId || null; if (!windowId) { try { state.targetWindowId = (await chrome.tabs.get(tabId)).windowId; } catch { /* ignore */ } } }
    await refreshTabs();
    updateButtons();
    log(`대시보드 준비 완료 (v${VERSION}). 대상 탭을 확인하고 "이 페이지 캡처"를 누르세요.`);
    window.SCD.ready = true;
  })();
})();
