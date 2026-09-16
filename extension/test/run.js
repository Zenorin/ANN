/* End-to-end test: loads the extension in headless Chromium (Playwright), captures/crawls the mock site
 * served by site/server.py on 127.0.0.1:8123, then writes summary JSON, the ZIP and screenshots to test/out/.
 * Usage: node run.js [capture|crawl]   (start the server first: python3 site/server.py 8123) */
const fs = require('fs');
const path = require('path');
function resolvePlaywright() {
  for (const c of ['playwright', path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')]) {
    try { return require.resolve(c); } catch { /* next */ }
  }
  throw new Error('playwright not found: run `npm install` in extension/test (or install it globally)');
}
const { chromium } = require(resolvePlaywright());
const EXT = path.resolve(__dirname, '..');
const SCRATCH = __dirname;
const PROFILE = path.join(SCRATCH, 'profile');
const OUT = path.join(SCRATCH, 'out');
const MODE = process.argv[2] || 'capture'; // capture | crawl
const BASE = process.env.SITE_URL || 'http://127.0.0.1:8123/';
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium', headless: true, viewport: null,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1280,900', '--screen-info={1920x1080}'],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  console.log('extension id:', new URL(sw.url()).host);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page:error]', m.text()); });
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  console.log('page title:', await page.title(), 'viewport:', await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]));

  const dashPromise = ctx.waitForEvent('page', (p) => p.url().includes('dashboard.html'));
  const info = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/*' });
    const win = await chrome.windows.create({ url: chrome.runtime.getURL(`dashboard/dashboard.html?tabId=${tab.id}&windowId=${tab.windowId}`), type: 'popup', width: 1000, height: 800 });
    return { tabId: tab.id, windowId: tab.windowId, dashWindow: win.id };
  });
  console.log('tab/window:', info);
  const dash = await dashPromise;
  dash.on('console', (m) => console.log(`[dash:${m.type()}]`, m.text()));
  dash.on('pageerror', (e) => console.log('[dash:pageerror]', e.message));
  await dash.waitForFunction(() => window.SCD && window.SCD.ready, null, { timeout: 20000 });
  await dash.evaluate((mode) => window.SCD.setOptions({ optResponsive: true, optWidths: '375, 768', optHookFromLoad: true, optStorageValues: true, optAssetSrcset: true, optCrawl: mode === 'crawl', optMaxPages: 4 }), MODE);
  const t0 = Date.now();
  if (MODE === 'crawl') await dash.evaluate(() => window.SCD.crawl()); else await dash.evaluate(() => window.SCD.capture());
  await dash.waitForFunction(() => window.SCD.ready && !window.SCD.state.running, null, { timeout: 300000, polling: 500 });
  console.log(`run finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const logText = await dash.evaluate(() => window.SCD.state.log.map((l) => `[${l.t}] ${l.level === 'info' ? '' : l.level.toUpperCase() + ' '}${l.msg}`).join('\n'));
  console.log('--- dashboard log ---\n' + logText + '\n---');
  const summary = await dash.evaluate(() => window.SCD.state.captures.map((c) => {
    const d = c.data;
    const sample = d.elements.find((e) => e.tag === 'button' && e.styles);
    return {
      url: c.url, slug: c.slug, title: c.title, ms: c.ms,
      elementCount: d.meta.elementCount, styled: d.elementStats.styled, truncated: d.elementStats.truncatedStyles,
      htmlLen: d.html.length, htmlHasScId: /data-sc-id="\d+"/.test(d.html),
      sheets: d.styles.sheets.map((s) => ({ href: s.href, rules: s.ruleCount, accessible: s.accessible, origin: s.origin })),
      fontFaces: d.styles.fontFaces, keyframes: d.styles.keyframes.map((k) => k.name), breakpoints: d.styles.breakpoints, rootVars: d.styles.rootVars, stateRules: d.styles.stateRules.length, imports: d.styles.imports,
      images: d.assets.images.map((i) => ({ src: i.currentSrc || i.src, originalSrc: i.originalSrc, natural: [i.naturalWidth, i.naturalHeight] })),
      bg: d.assets.backgroundImages.map((b) => ({ prop: b.prop, urls: b.urls, gradient: b.gradient && b.gradient.slice(0, 60) })),
      svgs: d.assets.svgs.length, favicons: d.assets.favicons,
      links: d.links.counts, internalUrls: d.links.internalUrls,
      landmarks: d.structure.landmarks.map((l) => `${l.tag}:${l.label || ''}:${Math.round(l.rect.w)}x${Math.round(l.rect.h)}`), headings: d.structure.headings.map((h) => `h${h.level} ${h.text}`), sections: d.structure.sections.map((s) => `${s.name} ${Math.round(s.rect.y)}+${Math.round(s.rect.h)}`),
      forms: d.forms.forms.map((f) => ({ action: f.action, method: f.method, fields: f.fields.map((x) => `${x.tag}:${x.type}:${x.name || ''}:${x.label || ''}`) })),
      interactive: d.interactive.slice(0, 12).map((i) => ({ text: i.text, tag: i.tag, cursor: i.cursor, reactHandlers: i.reactHandlers })),
      animations: { css: d.animations.css.length, transitions: d.animations.transitions.length, web: d.animations.webAnimations.length },
      storage: d.storage,
      tokens: { colors: d.tokens.colors.slice(0, 6), fonts: d.tokens.fontFamilies, sizes: d.tokens.fontSizes.slice(0, 5), radii: d.tokens.radii, maxWidths: d.tokens.maxWidths },
      frameworkHints: { next: d.frameworkHints.next && { buildId: d.frameworkHints.next.buildId, router: d.frameworkHints.next.routerGuess, nextData: d.frameworkHints.next.nextData && d.frameworkHints.next.nextData.page, imageOpt: d.frameworkHints.next.imageOptimizerUsed }, css: d.frameworkHints.css },
      hook: { present: d.hook.present, detect: d.hook.detect && { next: d.hook.detect.next, react: d.hook.detect.react, analytics: d.hook.detect.analytics, globals: (d.hook.detect.globals || []).map((g) => g.name).slice(0, 15) }, reactError: d.hook.reactError,
        react: d.hook.react && { nodeCount: d.hook.react.nodeCount, components: d.hook.react.components, owners: Object.keys(d.hook.react.ownerMap).length, handlers: d.hook.react.handlers },
        network: d.hook.network && d.hook.network.requests.map((r) => ({ kind: r.kind, method: r.method, url: r.url, status: r.status, ct: r.resHeaders && r.resHeaders['content-type'], body: r.resBody && r.resBody.slice(0, 60), reqHeaders: r.reqHeaders })),
        flight: d.hook.flight, console: d.hook.console },
      sampleButton: sample && { path: sample.path, styles: sample.styles, component: sample.component, events: sample.events },
      perf: { resources: d.performance.resources.length, nav: d.performance.navigation && d.performance.navigation.type },
      timings: d.timings,
      next: c.next,
      screenshots: { full: c.screenshots.full && { w: c.screenshots.full.width, h: c.screenshots.full.height, css: [c.screenshots.full.cssWidth, c.screenshots.full.cssHeight], frames: c.screenshots.full.frames, bytes: c.screenshots.full.blob.size, fixed: c.screenshots.full.fixedElements }, responsive: c.screenshots.responsive && Object.fromEntries(Object.entries(c.screenshots.responsive).map(([w, s]) => [w, { w: s.width, h: s.height, frames: s.frames }])), sections: (c.screenshots.sections || []).map((s) => `${s.name} ${Math.round(s.rect.w)}x${Math.round(s.rect.h)}`) },
      assets: c.assetRefs.map((r) => `${r.status} ${r.kind} ${r.url} -> ${r.path || ''} ${r.error || ''}`),
    };
  }));
  fs.writeFileSync(path.join(OUT, `summary-${MODE}.json`), JSON.stringify(summary, null, 2));
  console.log('summary written:', path.join(OUT, `summary-${MODE}.json`));
  const zipInfo = await dash.evaluate(async () => {
    const { blob, name, entries } = await window.SCD.buildZip();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { name, entries, size: buf.length, b64: btoa(s) };
  });
  fs.writeFileSync(path.join(OUT, zipInfo.name), Buffer.from(zipInfo.b64, 'base64'));
  console.log(`zip: ${zipInfo.name} entries=${zipInfo.entries} size=${zipInfo.size}`);
  // save screenshots for visual check
  const shots = await dash.evaluate(async () => {
    const out = [];
    for (const c of window.SCD.state.captures) {
      const conv = async (blob) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); };
      if (c.screenshots.full) out.push({ name: `${c.slug}-full.png`, b64: await conv(c.screenshots.full.blob) });
      for (const [w, s] of Object.entries(c.screenshots.responsive || {})) out.push({ name: `${c.slug}-w${w}.png`, b64: await conv(s.blob) });
      for (const s of (c.screenshots.sections || []).slice(0, 3)) out.push({ name: `${c.slug}-${s.name}.png`, b64: await conv(s.blob) });
    }
    return out;
  });
  for (const s of shots) fs.writeFileSync(path.join(OUT, s.name), Buffer.from(s.b64, 'base64'));
  console.log('screenshots saved:', shots.map((s) => s.name).join(', '));
  await ctx.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
