/* Site Clone Collector — content script (ISOLATED world).
 *
 * Injected on demand by the dashboard (chrome.scripting.executeScript).
 * Responsibilities:
 *   - snapshot the rendered DOM (with data-sc-id annotations for cross-referencing)
 *   - per-element non-default computed styles + page geometry
 *   - stylesheets, @font-face, @keyframes, media queries, CSS custom properties, :hover/:focus rules
 *   - assets (images, background images, inline SVG, video/audio/iframe/canvas, favicons)
 *   - links, scripts, structure (landmarks/headings/sections), forms, interactive elements
 *   - animations, performance resources, storage keys
 *   - design-token frequency analysis
 *   - screenshot helpers (scroll/fixed-element handling) driven by the dashboard
 *   - bridge to the MAIN-world hook (content/hook.js) for framework/React/network data
 */
(() => {
  'use strict';
  if (globalThis.__SC_COLLECTOR__) return;
  const SC = (globalThis.__SC_COLLECTOR__ = { version: '0.1.0', parts: null });

  // ------------------------------------------------------------------ constants
  const INHERITED = new Set([
    'border-collapse', 'border-spacing', 'caption-side', 'color', 'cursor', 'direction', 'empty-cells',
    'font', 'font-family', 'font-feature-settings', 'font-kerning', 'font-optical-sizing', 'font-palette',
    'font-size', 'font-size-adjust', 'font-stretch', 'font-style', 'font-synthesis', 'font-synthesis-weight',
    'font-synthesis-style', 'font-synthesis-small-caps', 'font-variant', 'font-variant-alternates',
    'font-variant-caps', 'font-variant-east-asian', 'font-variant-emoji', 'font-variant-ligatures',
    'font-variant-numeric', 'font-variant-position', 'font-variation-settings', 'font-weight',
    'hyphens', 'hyphenate-character', 'hyphenate-limit-chars', 'image-orientation', 'image-rendering',
    'letter-spacing', 'line-break', 'line-height', 'list-style', 'list-style-image', 'list-style-position',
    'list-style-type', 'math-depth', 'math-shift', 'math-style', 'orphans', 'overflow-wrap', 'paint-order',
    'pointer-events', 'quotes', 'ruby-align', 'ruby-position', 'speak', 'tab-size', 'text-align',
    'text-align-last', 'text-anchor', 'text-autospace', 'text-combine-upright', 'text-decoration-skip-ink',
    'text-emphasis', 'text-emphasis-color', 'text-emphasis-position', 'text-emphasis-style', 'text-indent',
    'text-justify', 'text-orientation', 'text-rendering', 'text-shadow', 'text-size-adjust', 'text-spacing-trim',
    'text-transform', 'text-underline-offset', 'text-underline-position', 'text-wrap', 'text-wrap-mode',
    'text-wrap-style', 'visibility', 'white-space', 'white-space-collapse', 'widows', 'word-break',
    'word-spacing', 'word-wrap', 'writing-mode', 'color-scheme', 'forced-color-adjust', 'print-color-adjust',
    'accent-color', 'caret-color', 'user-select', 'interpolate-size', 'font-language-override',
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'clip-rule', 'color-interpolation',
    'color-interpolation-filters', 'dominant-baseline', 'marker-end', 'marker-mid', 'marker-start',
    'shape-rendering', 'glyph-orientation-vertical', 'scrollbar-color', 'scrollbar-gutter',
    '-webkit-font-smoothing', '-webkit-locale', '-webkit-text-fill-color', '-webkit-text-stroke',
    '-webkit-text-stroke-color', '-webkit-text-stroke-width', '-webkit-text-security', '-webkit-rtl-ordering',
    '-webkit-user-modify', '-webkit-print-color-adjust', '-webkit-tap-highlight-color', '-webkit-text-orientation',
    '-webkit-writing-mode', '-webkit-line-break', '-webkit-text-combine', '-webkit-text-decorations-in-effect',
    '-webkit-user-select', '-webkit-text-emphasis-color', '-webkit-text-emphasis-position',
    '-webkit-text-emphasis-style', '-webkit-hyphenate-character', '-webkit-box-direction', '-webkit-nbsp-mode',
  ]);
  // Layout-derived values that only add noise (geometry is captured separately as rects).
  const SKIP_PROPS = new Set(['width', 'height', 'inline-size', 'block-size', 'perspective-origin', '-webkit-locale']);
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'TITLE', 'HEAD', 'BASE']);
  const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL', 'OPTION']);
  const INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'checkbox', 'radio', 'switch', 'option', 'slider', 'combobox', 'textbox', 'searchbox', 'spinbutton', 'treeitem']);
  const STATE_PSEUDO = /:(hover|focus|active|focus-visible|focus-within|checked|disabled|visited|target|open|placeholder-shown)\b/;
  const MAX_TEXT = 300;
  const MAX_ATTR = 600;
  const MAX_INLINE_STYLE = 4000;

  // ------------------------------------------------------------------ helpers
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const clamp = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + `…[+${s.length - n}]` : s);
  const round = (n) => Math.round(n * 100) / 100;

  function absUrl(u, base) {
    if (!u) return '';
    try { return new URL(u, base || document.baseURI).href; } catch { return String(u); }
  }
  function hashStr(s) {
    // FNV-1a 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  function rectOf(el) {
    try {
      const r = el.getBoundingClientRect();
      return { x: round(r.left + window.scrollX), y: round(r.top + window.scrollY), w: round(r.width), h: round(r.height) };
    } catch { return { x: 0, y: 0, w: 0, h: 0 }; }
  }
  function viewportRectOf(el) {
    const r = el.getBoundingClientRect();
    return { top: round(r.top), left: round(r.left), width: round(r.width), height: round(r.height), bottom: round(r.bottom), right: round(r.right) };
  }
  function parentOf(el) {
    const p = el.parentNode;
    if (!p) return null;
    if (p.nodeType === 1) return p;
    if (p.nodeType === 11 && p.host) return p.host; // ShadowRoot → host
    return null;
  }
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let node = el;
    let guard = 0;
    while (node && node.nodeType === 1 && guard++ < 200) {
      let part = node.localName;
      if (node.id && /^[A-Za-z_][\w:-]*$/.test(node.id)) {
        parts.unshift(`${part}#${CSS.escape(node.id)}`);
        break;
      }
      const parent = node.parentNode;
      if (parent && (parent.nodeType === 1 || parent.nodeType === 11)) {
        const siblings = Array.from(parent.children).filter((c) => c.localName === node.localName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (parent && parent.nodeType === 11) { parts.unshift('::shadow-root'); node = parent.host; continue; }
      node = parent && parent.nodeType === 1 ? parent : null;
    }
    return parts.join(' > ');
  }
  function ownText(el) {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.data;
    s = s.replace(/\s+/g, ' ').trim();
    return s ? clamp(s, MAX_TEXT) : '';
  }
  function colorToHex(v) {
    if (!v) return v;
    const m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/) ||
      v.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/);
    if (!m) return v;
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(parseFloat(x)))));
    let a = m[4] == null ? 1 : (String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (a >= 1) return hex;
    if (a <= 0) return 'transparent';
    return hex + Math.round(a * 255).toString(16).padStart(2, '0');
  }
  function extractUrls(value) {
    const out = [];
    if (!value || value === 'none') return out;
    const re = /url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g;
    let m;
    while ((m = re.exec(value))) { const u = (m[1] ?? m[2] ?? m[3] ?? '').trim(); if (u) out.push(u); }
    return out;
  }
  function allRoots() {
    // document + all open shadow roots (found during annotation)
    return [document, ...SC._shadowRoots];
  }
  function qsaAll(selector) {
    const out = [];
    for (const root of allRoots()) { try { out.push(...root.querySelectorAll(selector)); } catch { /* ignore */ } }
    return out;
  }

  // ------------------------------------------------------------------ UA defaults (hidden iframe)
  let defaultsFrame = null;
  const defaultsCache = new Map();
  function defaultsDoc() {
    if (defaultsFrame && defaultsFrame.contentDocument) return defaultsFrame.contentDocument;
    defaultsFrame = document.createElement('iframe');
    defaultsFrame.setAttribute('aria-hidden', 'true');
    defaultsFrame.setAttribute('data-sc-internal', '1');
    defaultsFrame.style.cssText = 'position:fixed !important;left:-9999px !important;top:0 !important;width:200px !important;height:200px !important;visibility:hidden !important;pointer-events:none !important;';
    defaultsFrame.src = 'about:blank';
    document.documentElement.appendChild(defaultsFrame);
    const doc = defaultsFrame.contentDocument;
    doc.open(); doc.write('<!DOCTYPE html><html><head></head><body></body></html>'); doc.close();
    return doc;
  }
  function releaseDefaults() {
    if (defaultsFrame) { try { defaultsFrame.remove(); } catch { /* ignore */ } }
    defaultsFrame = null;
    defaultsCache.clear();
  }
  function defaultsFor(tag) {
    const key = tag.toLowerCase();
    if (defaultsCache.has(key)) return defaultsCache.get(key);
    const doc = defaultsDoc();
    let el;
    if (key === 'html') el = doc.documentElement;
    else if (key === 'body') el = doc.body;
    else { try { el = doc.createElement(key); } catch { el = doc.createElement('div'); } doc.body.appendChild(el); }
    const cs = doc.defaultView.getComputedStyle(el);
    const snap = Object.create(null);
    for (let i = 0; i < cs.length; i++) { const p = cs[i]; snap[p] = cs.getPropertyValue(p); }
    if (el !== doc.documentElement && el !== doc.body) el.remove();
    defaultsCache.set(key, snap);
    return snap;
  }

  // ------------------------------------------------------------------ MAIN-world hook bridge
  let hookReqId = 0;
  const hookPending = new Map();
  document.addEventListener('sc:res', (e) => {
    let msg;
    try { msg = JSON.parse(e.detail); } catch { return; }
    const p = hookPending.get(msg.id);
    if (!p) return;
    hookPending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.data); else p.reject(new Error(msg.error || 'hook error'));
  });
  function hookRequest(cmd, args, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const id = ++hookReqId;
      const timer = setTimeout(() => { if (hookPending.delete(id)) reject(new Error(`hook timeout: ${cmd}`)); }, timeoutMs);
      hookPending.set(id, { resolve, reject, timer });
      document.dispatchEvent(new CustomEvent('sc:req', { detail: JSON.stringify({ id, cmd, args: args || {} }) }));
    });
  }
  async function hookPresent() {
    try { const r = await hookRequest('ping', {}, 800); return !!(r && r.hook); } catch { return false; }
  }

  // ------------------------------------------------------------------ annotation & serialization
  SC._shadowRoots = [];
  function annotateAll() {
    const ids = new Map();
    const shadowHosts = [];
    SC._shadowRoots = [];
    let counter = 0;
    const stack = [document.documentElement];
    while (stack.length) {
      const el = stack.pop();
      if (el.hasAttribute('data-sc-internal')) continue;
      const id = counter++;
      try { el.setAttribute('data-sc-id', String(id)); } catch { /* ignore */ }
      ids.set(el, id);
      const kids = el.children;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      if (el.shadowRoot) {
        shadowHosts.push(el);
        SC._shadowRoots.push(el.shadowRoot);
        const sk = el.shadowRoot.children;
        for (let i = sk.length - 1; i >= 0; i--) stack.push(sk[i]);
      }
    }
    return { ids, shadowHosts, count: counter };
  }
  function removeAnnotations() {
    for (const el of qsaAll('[data-sc-id]')) el.removeAttribute('data-sc-id');
    try { document.documentElement.removeAttribute('data-sc-id'); } catch { /* ignore */ }
  }
  function serializeDocument(shadowHosts) {
    const dt = document.doctype;
    const doctype = dt
      ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : ''}${dt.systemId ? ` "${dt.systemId}"` : ''}>`
      : '';
    // Strip our own helper iframe from the snapshot.
    const internal = document.querySelectorAll('[data-sc-internal]');
    if (!shadowHosts.length && !internal.length) return `${doctype}\n${document.documentElement.outerHTML}`;
    const clone = document.documentElement.cloneNode(true);
    for (const n of clone.querySelectorAll('[data-sc-internal]')) n.remove();
    for (const host of shadowHosts) {
      const id = host.getAttribute('data-sc-id');
      const c = clone.querySelector(`[data-sc-id="${id}"]`);
      if (!c) continue;
      const t = document.createElement('template');
      t.setAttribute('shadowrootmode', host.shadowRoot.mode || 'open');
      t.innerHTML = host.shadowRoot.innerHTML;
      c.prepend(t);
    }
    return `${doctype}\n${clone.outerHTML}`;
  }

  // ------------------------------------------------------------------ meta / head
  function collectMeta() {
    const html = document.documentElement;
    const body = document.body;
    const dt = document.doctype;
    let darkPref = false;
    try { darkPref = matchMedia('(prefers-color-scheme: dark)').matches; } catch { /* ignore */ }
    return {
      url: location.href,
      origin: location.origin,
      pathname: location.pathname,
      title: document.title,
      lang: html.getAttribute('lang') || '',
      dir: html.getAttribute('dir') || '',
      charset: document.characterSet,
      doctype: dt ? { name: dt.name, publicId: dt.publicId, systemId: dt.systemId } : null,
      compatMode: document.compatMode,
      referrer: document.referrer,
      capturedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      language: navigator.language,
      timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })(),
      prefersDark: darkPref,
      viewport: {
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
        outerWidth: window.outerWidth, outerHeight: window.outerHeight,
        devicePixelRatio: window.devicePixelRatio,
        scrollX: window.scrollX, scrollY: window.scrollY,
      },
      document: {
        scrollWidth: Math.max(html.scrollWidth, body ? body.scrollWidth : 0),
        scrollHeight: Math.max(html.scrollHeight, body ? body.scrollHeight : 0),
        clientWidth: html.clientWidth, clientHeight: html.clientHeight,
      },
      htmlAttrs: attrsOf(html, true),
      bodyAttrs: body ? attrsOf(body, true) : {},
      elementCount: document.getElementsByTagName('*').length,
      fontsLoaded: (() => { try { return document.fonts.status; } catch { return ''; } })(),
    };
  }
  function attrsOf(el, includeClass) {
    const out = {};
    for (const a of el.attributes) {
      if (a.name === 'data-sc-id') continue;
      if (!includeClass && (a.name === 'class' || a.name === 'style')) continue;
      out[a.name] = clamp(a.value, MAX_ATTR);
    }
    return out;
  }
  function collectHead() {
    const metaTags = [];
    for (const m of document.querySelectorAll('meta')) {
      const o = {};
      for (const a of m.attributes) if (a.name !== 'data-sc-id') o[a.name] = clamp(a.value, 2000);
      metaTags.push(o);
    }
    const links = [];
    for (const l of document.querySelectorAll('link')) {
      const o = {};
      for (const a of l.attributes) if (a.name !== 'data-sc-id') o[a.name] = clamp(a.value, 2000);
      if (o.href) o.hrefAbs = absUrl(o.href);
      links.push(o);
    }
    const base = document.querySelector('base');
    return { title: document.title, metaTags, links, base: base ? base.getAttribute('href') : null, baseURI: document.baseURI };
  }

  // ------------------------------------------------------------------ elements + computed styles
  function collectElements(ids, opts) {
    const wantStyles = opts.styles !== false;
    const maxStyled = opts.maxStyledElements || 6000;
    const elements = [];
    const csCache = new Map();
    const getCS = (el) => { let cs = csCache.get(el); if (!cs) { cs = getComputedStyle(el); csCache.set(el, cs); } return cs; };
    const stats = { total: 0, styled: 0, skippedSvgInner: 0, truncatedStyles: false };
    const bgImages = [];
    const animated = [];
    const transitions = [];
    const interactiveCandidates = [];
    const interactiveSet = new Set();
    const stack = [{ el: document.documentElement, depth: 0, inSvg: false }];
    const scrollX = window.scrollX, scrollY = window.scrollY;

    while (stack.length) {
      const { el, depth, inSvg } = stack.pop();
      if (el.hasAttribute('data-sc-internal')) continue;
      const id = ids.get(el);
      if (id == null) continue;
      const tag = el.tagName;
      const isSvgRoot = el.localName === 'svg' && !inSvg;
      const childInSvg = inSvg || isSvgRoot;

      // push children (reverse for document order)
      const kids = el.children;
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ el: kids[i], depth: depth + 1, inSvg: childInSvg });
      if (el.shadowRoot) { const sk = el.shadowRoot.children; for (let i = sk.length - 1; i >= 0; i--) stack.push({ el: sk[i], depth: depth + 1, inSvg: childInSvg }); }

      if (SKIP_TAGS.has(tag)) continue;
      if (inSvg) { stats.skippedSvgInner++; continue; }
      stats.total++;

      const parent = parentOf(el);
      const rect = rectOf(el);
      const cs = getCS(el);
      const display = cs.getPropertyValue('display');
      const visibility = cs.getPropertyValue('visibility');
      const opacity = cs.getPropertyValue('opacity');
      const visible = display !== 'none' && visibility !== 'hidden' && rect.w > 0 && rect.h > 0;
      const rec = {
        id, tag: el.localName, path: cssPath(el), parent: parent ? ids.get(parent) ?? null : null, depth,
        idAttr: el.id || undefined,
        classes: el.classList.length ? Array.from(el.classList) : undefined,
        attrs: attrsOf(el, false),
        text: ownText(el) || undefined,
        rect, visible,
      };
      if (el.shadowRoot) rec.shadowHost = true;
      const inlineStyle = el.getAttribute('style');
      if (inlineStyle) rec.inlineStyle = clamp(inlineStyle, MAX_INLINE_STYLE);
      if (Object.keys(rec.attrs).length === 0) delete rec.attrs;

      if (wantStyles && stats.styled < maxStyled) {
        stats.styled++;
        const def = defaultsFor(el.localName);
        const parentCS = parent ? getCS(parent) : null;
        const styles = {};
        const transform = cs.getPropertyValue('transform');
        for (let i = 0; i < cs.length; i++) {
          const p = cs[i];
          if (SKIP_PROPS.has(p)) continue;
          if (p === 'transform-origin' && transform === 'none') continue;
          const v = cs.getPropertyValue(p);
          if (v === def[p]) continue;
          if (parentCS && INHERITED.has(p) && v === parentCS.getPropertyValue(p)) continue;
          styles[p] = v;
        }
        if (Object.keys(styles).length) rec.styles = styles;
        // pseudo elements
        for (const pseudo of ['::before', '::after']) {
          try {
            const pcs = getComputedStyle(el, pseudo);
            const content = pcs.getPropertyValue('content');
            if (!content || content === 'none' || content === 'normal') continue;
            const ps = { content };
            for (let i = 0; i < pcs.length; i++) {
              const p = pcs[i];
              if (SKIP_PROPS.has(p) || p === 'content') continue;
              const v = pcs.getPropertyValue(p);
              if (v !== cs.getPropertyValue(p)) ps[p] = v;
            }
            rec[pseudo === '::before' ? 'before' : 'after'] = ps;
          } catch { /* ignore */ }
        }
        // derived collections
        const bgi = cs.getPropertyValue('background-image');
        const maskImg = cs.getPropertyValue('mask-image') || cs.getPropertyValue('-webkit-mask-image');
        const borderImg = cs.getPropertyValue('border-image-source');
        for (const [prop, val] of [['background-image', bgi], ['mask-image', maskImg], ['border-image-source', borderImg]]) {
          if (val && val !== 'none') {
            const urls = extractUrls(val).map((u) => absUrl(u));
            const gradients = /gradient\(/.test(val) ? val : undefined;
            if (urls.length || gradients) {
              bgImages.push({ id, path: rec.path, prop, urls, gradient: gradients ? clamp(gradients, 1000) : undefined,
                size: cs.getPropertyValue('background-size'), position: cs.getPropertyValue('background-position'), repeat: cs.getPropertyValue('background-repeat'), rect });
            }
          }
        }
        const animName = cs.getPropertyValue('animation-name');
        if (animName && animName !== 'none') {
          animated.push({ id, path: rec.path, name: animName, duration: cs.getPropertyValue('animation-duration'), timing: cs.getPropertyValue('animation-timing-function'), delay: cs.getPropertyValue('animation-delay'), iteration: cs.getPropertyValue('animation-iteration-count'), direction: cs.getPropertyValue('animation-direction'), fill: cs.getPropertyValue('animation-fill-mode'), playState: cs.getPropertyValue('animation-play-state') });
        }
        const trDur = cs.getPropertyValue('transition-duration');
        if (trDur && trDur !== '0s' && !/^(0s,?\s*)+$/.test(trDur)) {
          transitions.push({ id, path: rec.path, property: cs.getPropertyValue('transition-property'), duration: trDur, timing: cs.getPropertyValue('transition-timing-function'), delay: cs.getPropertyValue('transition-delay') });
        }
        const cursor = cs.getPropertyValue('cursor');
        const role = el.getAttribute('role');
        const explicitInteractive = INTERACTIVE_TAGS.has(tag) || (role && INTERACTIVE_ROLES.has(role)) || el.hasAttribute('onclick') || el.hasAttribute('tabindex');
        if (explicitInteractive) {
          interactiveCandidates.push({ el, id, path: rec.path, cursor, role });
          interactiveSet.add(el);
        } else if (cursor === 'pointer') {
          // Skip descendants of an element that is already interactive (icon inside a button, text inside a clickable card…)
          let anc = parentOf(el), nested = false, guard = 0;
          while (anc && guard++ < 40) { if (interactiveSet.has(anc)) { nested = true; break; } anc = parentOf(anc); }
          if (!nested) { interactiveCandidates.push({ el, id, path: rec.path, cursor, role }); interactiveSet.add(el); }
        }
        if (opacity !== '1') rec.opacity = opacity;
        // Effective text style (independent of inheritance) for token statistics
        if (rec.text && visible) {
          rec.fx = {
            color: colorToHex(cs.getPropertyValue('color')),
            family: (cs.getPropertyValue('font-family').split(',')[0] || '').trim().replace(/^["']|["']$/g, ''),
            stack: cs.getPropertyValue('font-family'),
            size: cs.getPropertyValue('font-size'),
            weight: cs.getPropertyValue('font-weight'),
            lineHeight: cs.getPropertyValue('line-height'),
            letterSpacing: cs.getPropertyValue('letter-spacing'),
          };
        }
      }
      elements.push(rec);
    }
    if (wantStyles && stats.styled >= maxStyled && stats.total > maxStyled) stats.truncatedStyles = true;
    return { elements, stats, bgImages, animated, transitions, interactiveCandidates, csCache };
  }

  // ------------------------------------------------------------------ stylesheets
  function collectStyles() {
    const sheets = [];
    const fontFaces = [];
    const keyframes = [];
    const mediaQueries = new Map(); // text -> count
    const customProps = {}; // name -> [{selector, value}]
    const stateRules = [];
    const imports = [];
    const propertyRules = [];
    const layers = new Set();
    const containerQueries = new Set();
    let ruleTotal = 0;
    const seenSheets = new Set();

    function addCustomProp(name, value, selector) {
      if (!customProps[name]) customProps[name] = [];
      if (customProps[name].length < 20) customProps[name].push({ selector: clamp(selector, 200), value: clamp(value, 500) });
    }
    function walkRules(rules, ctx, sheetRec) {
      for (const rule of rules) {
        ruleTotal++;
        const cname = rule.constructor && rule.constructor.name;
        try {
          if (rule instanceof CSSStyleRule) {
            const sel = rule.selectorText || '';
            if (STATE_PSEUDO.test(sel) && stateRules.length < 3000) stateRules.push({ selector: clamp(sel, 500), css: clamp(rule.style.cssText, 3000), media: ctx.media || undefined, sheet: sheetRec.index });
            const st = rule.style;
            for (let i = 0; i < st.length; i++) { const p = st[i]; if (p.startsWith('--')) addCustomProp(p, st.getPropertyValue(p).trim(), sel); }
            if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules, ctx, sheetRec); // nesting
          } else if (rule instanceof CSSImportRule) {
            imports.push({ href: absUrl(rule.href, sheetRec.href || undefined), media: rule.media ? rule.media.mediaText : '', layer: rule.layerName || undefined, sheet: sheetRec.index });
            if (rule.styleSheet) processSheet(rule.styleSheet, 'import', sheetRec.index);
          } else if (rule instanceof CSSMediaRule) {
            const mt = rule.media.mediaText;
            mediaQueries.set(mt, (mediaQueries.get(mt) || 0) + 1);
            walkRules(rule.cssRules, { ...ctx, media: ctx.media ? `${ctx.media} and ${mt}` : mt }, sheetRec);
          } else if (rule instanceof CSSFontFaceRule) {
            const s = rule.style;
            fontFaces.push({
              family: s.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, ''),
              src: s.getPropertyValue('src').trim(),
              srcUrls: extractUrls(s.getPropertyValue('src')).map((u) => absUrl(u, sheetRec.href || undefined)),
              weight: s.getPropertyValue('font-weight').trim() || undefined,
              style: s.getPropertyValue('font-style').trim() || undefined,
              display: s.getPropertyValue('font-display').trim() || undefined,
              unicodeRange: s.getPropertyValue('unicode-range').trim() || undefined,
              stretch: s.getPropertyValue('font-stretch').trim() || undefined,
              sheet: sheetRec.index,
            });
          } else if (rule instanceof CSSKeyframesRule) {
            keyframes.push({ name: rule.name, css: clamp(rule.cssText, 20000), sheet: sheetRec.index });
          } else if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
            walkRules(rule.cssRules, ctx, sheetRec);
          } else if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) {
            layers.add(rule.name); walkRules(rule.cssRules, ctx, sheetRec);
          } else if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
            containerQueries.add(rule.conditionText); walkRules(rule.cssRules, ctx, sheetRec);
          } else if (typeof CSSPropertyRule !== 'undefined' && rule instanceof CSSPropertyRule) {
            propertyRules.push({ name: rule.name, syntax: rule.syntax, inherits: rule.inherits, initialValue: rule.initialValue });
          } else if (cname === 'CSSScopeRule' || cname === 'CSSStartingStyleRule') {
            if (rule.cssRules) walkRules(rule.cssRules, ctx, sheetRec);
          }
        } catch { /* ignore individual rule errors */ }
      }
    }
    function processSheet(sheet, origin, parentIndex) {
      if (!sheet || seenSheets.has(sheet)) return;
      seenSheets.add(sheet);
      const owner = sheet.ownerNode;
      const rec = {
        index: sheets.length, origin, parent: parentIndex,
        href: sheet.href ? absUrl(sheet.href) : null,
        media: sheet.media ? sheet.media.mediaText : '',
        disabled: sheet.disabled, title: sheet.title || undefined,
        ownerTag: owner ? owner.localName : undefined,
        ownerId: owner && owner.id ? owner.id : undefined,
        ownerAttrs: owner && owner.nodeType === 1 ? attrsOf(owner, true) : undefined,
        ruleCount: 0, accessible: true,
      };
      sheets.push(rec);
      let rules = null;
      try { rules = sheet.cssRules; } catch (e) { rec.accessible = false; rec.error = String(e && e.message || e); }
      if (rules) {
        rec.ruleCount = rules.length;
        const parts = [];
        let size = 0;
        for (const r of rules) { const t = r.cssText; size += t.length; if (size < 3_000_000) parts.push(t); }
        rec.cssText = parts.join('\n');
        if (size >= 3_000_000) rec.cssTextTruncated = true;
        walkRules(rules, { media: rec.media || '' }, rec);
      }
      if (owner && owner.localName === 'style') rec.inlineText = clamp(owner.textContent || '', 3_000_000);
    }
    for (const s of document.styleSheets) processSheet(s, 'document');
    try { for (const s of document.adoptedStyleSheets || []) processSheet(s, 'adopted'); } catch { /* ignore */ }
    for (const sr of SC._shadowRoots) {
      try { for (const s of sr.styleSheets) processSheet(s, 'shadow'); } catch { /* ignore */ }
      try { for (const s of sr.adoptedStyleSheets || []) processSheet(s, 'shadow-adopted'); } catch { /* ignore */ }
    }
    // computed values of custom properties on :root
    const rootCS = getComputedStyle(document.documentElement);
    const rootVars = {};
    for (const name of Object.keys(customProps)) { const v = rootCS.getPropertyValue(name); if (v) rootVars[name] = v.trim(); }
    // breakpoints
    const breakpoints = new Set();
    for (const mq of mediaQueries.keys()) {
      const re = /(min|max)-width\s*:\s*([\d.]+)(px|em|rem)/g;
      let m;
      while ((m = re.exec(mq))) { const n = parseFloat(m[2]); breakpoints.add(m[3] === 'px' ? n : n * 16); }
    }
    return {
      sheets, fontFaces, keyframes, imports, propertyRules,
      mediaQueries: Array.from(mediaQueries, ([text, count]) => ({ text, count })),
      breakpoints: Array.from(breakpoints).sort((a, b) => a - b),
      customProps, rootVars, stateRules, layers: Array.from(layers), containerQueries: Array.from(containerQueries),
      ruleTotal,
    };
  }

  function collectFonts(elements) {
    const loaded = [];
    try { for (const f of document.fonts) loaded.push({ family: f.family, weight: f.weight, style: f.style, status: f.status, display: f.display, unicodeRange: f.unicodeRange && f.unicodeRange !== 'U+0-10FFFF' ? f.unicodeRange : undefined }); } catch { /* ignore */ }
    return { status: (() => { try { return document.fonts.status; } catch { return ''; } })(), loaded: loaded.slice(0, 500) };
  }

  // ------------------------------------------------------------------ assets
  function collectAssets(ids, bgImages) {
    const images = [];
    for (const img of qsaAll('img')) {
      const picture = img.closest('picture');
      const sources = picture ? Array.from(picture.querySelectorAll('source')).map((s) => ({ srcset: clamp(s.getAttribute('srcset') || '', 4000), media: s.getAttribute('media') || undefined, type: s.getAttribute('type') || undefined, sizes: s.getAttribute('sizes') || undefined })) : undefined;
      const src = img.getAttribute('src') || '';
      const rec = {
        id: ids.get(img), path: cssPath(img),
        src: absUrl(src), currentSrc: img.currentSrc || '', srcset: clamp(img.getAttribute('srcset') || '', 4000) || undefined,
        sizes: img.getAttribute('sizes') || undefined, alt: img.getAttribute('alt') ?? undefined, title: img.getAttribute('title') || undefined,
        width: img.getAttribute('width') || undefined, height: img.getAttribute('height') || undefined,
        naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, complete: img.complete,
        loading: img.getAttribute('loading') || undefined, decoding: img.getAttribute('decoding') || undefined, fetchpriority: img.getAttribute('fetchpriority') || undefined,
        rect: rectOf(img), objectFit: getComputedStyle(img).objectFit, sources,
      };
      const optimized = nextImageOriginal(rec.currentSrc || rec.src);
      if (optimized) rec.originalSrc = optimized;
      images.push(rec);
    }
    const svgs = [];
    for (const svg of qsaAll('svg')) {
      if (svg.closest('svg') !== svg) continue; // nested
      const html = svg.outerHTML;
      svgs.push({ id: ids.get(svg), path: cssPath(svg), hash: hashStr(html), size: html.length, viewBox: svg.getAttribute('viewBox') || undefined, rect: rectOf(svg), outerHTML: clamp(html, 200000), useRefs: Array.from(svg.querySelectorAll('use')).map((u) => u.getAttribute('href') || u.getAttribute('xlink:href')).filter(Boolean).slice(0, 10) });
    }
    const videos = qsaAll('video').map((v) => ({ id: ids.get(v), path: cssPath(v), src: absUrl(v.getAttribute('src') || ''), currentSrc: v.currentSrc || '', poster: absUrl(v.getAttribute('poster') || ''), sources: Array.from(v.querySelectorAll('source')).map((s) => ({ src: absUrl(s.getAttribute('src') || ''), type: s.getAttribute('type') || undefined })), autoplay: v.autoplay, loop: v.loop, muted: v.muted, controls: v.controls, playsInline: v.playsInline, rect: rectOf(v), duration: Number.isFinite(v.duration) ? v.duration : undefined }));
    const audios = qsaAll('audio').map((a) => ({ id: ids.get(a), path: cssPath(a), src: absUrl(a.getAttribute('src') || ''), currentSrc: a.currentSrc || '', sources: Array.from(a.querySelectorAll('source')).map((s) => ({ src: absUrl(s.getAttribute('src') || ''), type: s.getAttribute('type') || undefined })), autoplay: a.autoplay, loop: a.loop, controls: a.controls }));
    const iframes = qsaAll('iframe').filter((f) => !f.hasAttribute('data-sc-internal')).map((f) => ({ id: ids.get(f), path: cssPath(f), src: absUrl(f.getAttribute('src') || ''), title: f.getAttribute('title') || undefined, allow: f.getAttribute('allow') || undefined, sandbox: f.getAttribute('sandbox') || undefined, loading: f.getAttribute('loading') || undefined, rect: rectOf(f) }));
    const canvases = qsaAll('canvas').map((c) => { let dataUrl; try { dataUrl = c.toDataURL('image/png'); if (dataUrl.length > 4_000_000) dataUrl = undefined; } catch { dataUrl = undefined; } return { id: ids.get(c), path: cssPath(c), width: c.width, height: c.height, rect: rectOf(c), dataUrl, contextHint: c.getContext && (c.getContext('2d') ? '2d' : 'webgl/other') }; });
    const objects = qsaAll('object, embed').map((o) => ({ id: ids.get(o), path: cssPath(o), src: absUrl(o.getAttribute('data') || o.getAttribute('src') || ''), type: o.getAttribute('type') || undefined, rect: rectOf(o) }));
    const favicons = [];
    for (const l of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="mask-icon"], link[rel="manifest"]')) {
      favicons.push({ rel: l.getAttribute('rel'), href: absUrl(l.getAttribute('href') || ''), sizes: l.getAttribute('sizes') || undefined, type: l.getAttribute('type') || undefined, color: l.getAttribute('color') || undefined });
    }
    favicons.push({ rel: 'default', href: absUrl('/favicon.ico') });
    return { images, backgroundImages: bgImages, svgs, videos, audios, iframes, canvases, objects, favicons };
  }
  function nextImageOriginal(u) {
    // Next.js image optimizer: /_next/image?url=<encoded>&w=..&q=..
    try {
      const url = new URL(u, location.href);
      if (/\/_next\/image$/.test(url.pathname) || /\/_vercel\/image$/.test(url.pathname)) {
        const orig = url.searchParams.get('url');
        if (orig) return absUrl(orig);
      }
    } catch { /* ignore */ }
    return null;
  }

  // ------------------------------------------------------------------ links / scripts / structure / forms
  function collectLinks(ids) {
    const list = [];
    const internalSet = new Set();
    for (const a of qsaAll('a[href], area[href]')) {
      const raw = a.getAttribute('href') || '';
      const href = absUrl(raw);
      let internal = false;
      let kind = 'external';
      if (/^(mailto|tel|sms|javascript):/i.test(raw)) kind = raw.split(':')[0].toLowerCase();
      else {
        try { const u = new URL(href); internal = u.origin === location.origin; kind = internal ? (u.hash && u.pathname === location.pathname ? 'anchor' : 'internal') : 'external'; } catch { kind = 'invalid'; }
      }
      if (kind === 'internal') internalSet.add(href.split('#')[0]);
      list.push({ id: ids.get(a), path: cssPath(a), href, raw: clamp(raw, 500), text: clamp((a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim(), 160), target: a.getAttribute('target') || undefined, rel: a.getAttribute('rel') || undefined, kind, rect: rectOf(a), download: a.hasAttribute('download') || undefined, ariaLabel: a.getAttribute('aria-label') || undefined });
    }
    return { list, internalUrls: Array.from(internalSet), counts: list.reduce((acc, l) => { acc[l.kind] = (acc[l.kind] || 0) + 1; return acc; }, {}) };
  }
  function collectScripts(ids) {
    const scripts = [];
    let inlineBudget = 3_000_000;
    for (const s of document.querySelectorAll('script')) {
      const rec = { id: ids.get(s), src: s.src ? absUrl(s.src) : undefined, type: s.getAttribute('type') || undefined, async: s.async || undefined, defer: s.defer || undefined, module: s.type === 'module' || undefined, nomodule: s.noModule || undefined, idAttr: s.id || undefined, crossorigin: s.getAttribute('crossorigin') || undefined, integrity: s.getAttribute('integrity') || undefined, nonce: s.nonce ? true : undefined, dataset: Object.keys(s.dataset).length ? { ...s.dataset } : undefined };
      if (!s.src) {
        const text = s.textContent || '';
        rec.inlineSize = text.length;
        const t = s.getAttribute('type') || '';
        const isData = /json|ld\+json|importmap|speculationrules|text\/(template|x-)/.test(t);
        const take = isData ? Math.min(text.length, 2_000_000) : Math.min(text.length, 200_000);
        if (take <= inlineBudget) { rec.inline = text.slice(0, take); inlineBudget -= take; if (take < text.length) rec.inlineTruncated = true; } else rec.inlineOmitted = true;
      }
      scripts.push(rec);
    }
    return scripts;
  }
  function headingText(el) {
    const h = el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
    return h ? clamp((h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim(), 120) : '';
  }
  function collectStructure(ids) {
    const landmarkSel = 'header, nav, main, footer, aside, section, article, form, dialog, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"], [role="region"], [role="dialog"], [role="search"]';
    const landmarks = [];
    for (const el of qsaAll(landmarkSel)) {
      const rect = rectOf(el);
      if (landmarks.length >= 400) break;
      landmarks.push({ id: ids.get(el), tag: el.localName, role: el.getAttribute('role') || undefined, path: cssPath(el), label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || headingText(el) || undefined, idAttr: el.id || undefined, classes: el.classList.length ? Array.from(el.classList).slice(0, 8) : undefined, rect, children: el.children.length, textPreview: clamp((el.innerText || '').replace(/\s+/g, ' ').trim(), 200) || undefined, depth: (() => { let d = 0, p = el; while ((p = parentOf(p))) d++; return d; })() });
    }
    const headings = [];
    for (const h of qsaAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
      const level = /^h[1-6]$/i.test(h.tagName) ? parseInt(h.tagName[1], 10) : parseInt(h.getAttribute('aria-level') || '2', 10);
      headings.push({ id: ids.get(h), level, text: clamp((h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim(), 200), path: cssPath(h), rect: rectOf(h) });
      if (headings.length >= 500) break;
    }
    // Sections for screenshot cropping: header/nav/footer landmarks + direct children of <main> (or body)
    const sections = [];
    const seen = new Set();
    const pushSection = (el, name) => {
      if (!el || seen.has(el)) return;
      const r = rectOf(el);
      if (r.w < 40 || r.h < 40) return;
      seen.add(el);
      sections.push({ id: ids.get(el), name: name || el.localName, tag: el.localName, path: cssPath(el), rect: r, label: el.getAttribute('aria-label') || headingText(el) || undefined });
    };
    for (const el of document.querySelectorAll('header, [role="banner"]')) pushSection(el, 'header');
    for (const el of document.querySelectorAll('nav, [role="navigation"]')) if (!el.closest('header')) pushSection(el, 'nav');
    const main = document.querySelector('main, [role="main"]') || document.body;
    if (main) {
      const kids = Array.from(main.children).filter((c) => !SKIP_TAGS.has(c.tagName) && !c.hasAttribute('data-sc-internal'));
      // If main has a single wrapper child, descend once.
      let list = kids;
      if (kids.length === 1 && kids[0].children.length > 1) list = Array.from(kids[0].children);
      let i = 1;
      for (const c of list) { if (c.matches('header, nav, footer')) continue; pushSection(c, `section-${String(i++).padStart(2, '0')}`); if (sections.length >= 60) break; }
    }
    for (const el of document.querySelectorAll('footer, [role="contentinfo"]')) pushSection(el, 'footer');
    sections.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    return { landmarks, headings, sections };
  }
  function labelFor(field) {
    if (field.id) { const l = document.querySelector(`label[for="${CSS.escape(field.id)}"]`); if (l) return clamp((l.innerText || l.textContent || '').trim(), 120); }
    const wrap = field.closest('label');
    if (wrap) return clamp((wrap.innerText || wrap.textContent || '').trim(), 120);
    return field.getAttribute('aria-label') || undefined;
  }
  function fieldRec(f, ids) {
    const type = (f.getAttribute('type') || (f.tagName === 'SELECT' ? 'select' : f.tagName === 'TEXTAREA' ? 'textarea' : 'text')).toLowerCase();
    const rec = { id: ids.get(f), tag: f.localName, type, name: f.getAttribute('name') || undefined, idAttr: f.id || undefined, placeholder: f.getAttribute('placeholder') || undefined, required: f.required || undefined, disabled: f.disabled || undefined, readOnly: f.readOnly || undefined, autocomplete: f.getAttribute('autocomplete') || undefined, pattern: f.getAttribute('pattern') || undefined, maxLength: f.maxLength > 0 ? f.maxLength : undefined, label: labelFor(f), path: cssPath(f), rect: rectOf(f) };
    if (type !== 'password') { try { rec.value = clamp(String(f.value ?? ''), 200) || undefined; } catch { /* ignore */ } }
    if (f.tagName === 'SELECT') rec.options = Array.from(f.options).slice(0, 200).map((o) => ({ value: clamp(o.value, 200), text: clamp(o.text, 200), selected: o.selected || undefined }));
    if (type === 'checkbox' || type === 'radio') rec.checked = f.checked;
    return rec;
  }
  function collectForms(ids) {
    const forms = [];
    const inForm = new Set();
    for (const form of qsaAll('form')) {
      const fields = Array.from(form.querySelectorAll('input, select, textarea, button')).map((f) => { inForm.add(f); return fieldRec(f, ids); });
      forms.push({ id: ids.get(form), path: cssPath(form), action: absUrl(form.getAttribute('action') || ''), method: (form.getAttribute('method') || 'get').toLowerCase(), name: form.getAttribute('name') || undefined, idAttr: form.id || undefined, enctype: form.getAttribute('enctype') || undefined, autocomplete: form.getAttribute('autocomplete') || undefined, rect: rectOf(form), fields });
    }
    const orphanFields = qsaAll('input, select, textarea').filter((f) => !inForm.has(f) && f.type !== 'hidden').map((f) => fieldRec(f, ids));
    return { forms, orphanFields };
  }
  function collectInteractive(candidates, ids) {
    const out = [];
    for (const c of candidates) {
      const el = c.el;
      if (out.length >= 1500) break;
      let text = '';
      try { text = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim(); } catch { /* ignore */ }
      out.push({ id: c.id, path: c.path, tag: el.localName, role: c.role || undefined, text: clamp(text, 120) || undefined, href: el.tagName === 'A' ? absUrl(el.getAttribute('href') || '') : undefined, type: el.getAttribute('type') || undefined, ariaLabel: el.getAttribute('aria-label') || undefined, ariaExpanded: el.getAttribute('aria-expanded') || undefined, ariaControls: el.getAttribute('aria-controls') || undefined, dataState: el.getAttribute('data-state') || undefined, cursor: c.cursor, inlineHandlers: Array.from(el.attributes).filter((a) => a.name.startsWith('on')).map((a) => a.name), rect: rectOf(el), disabled: el.disabled || undefined });
    }
    return out;
  }
  function collectWebAnimations(ids) {
    const out = [];
    try {
      for (const a of document.getAnimations()) {
        if (out.length >= 300) break;
        const effect = a.effect;
        const target = effect && effect.target;
        let keyframes;
        try { keyframes = effect.getKeyframes ? effect.getKeyframes().slice(0, 20).map((k) => { const o = {}; for (const [kk, vv] of Object.entries(k)) o[kk] = typeof vv === 'string' ? clamp(vv, 300) : vv; return o; }) : undefined; } catch { /* ignore */ }
        let timing;
        try { timing = effect.getTiming ? effect.getTiming() : undefined; } catch { /* ignore */ }
        out.push({ idName: a.id || undefined, type: a.constructor.name, animationName: a.animationName || undefined, transitionProperty: a.transitionProperty || undefined, playState: a.playState, currentTime: a.currentTime, target: target ? { id: ids.get(target), path: cssPath(target) } : undefined, keyframes, timing });
      }
    } catch { /* ignore */ }
    return out;
  }
  function collectPerformance() {
    const resources = [];
    try {
      for (const e of performance.getEntriesByType('resource')) {
        if (resources.length >= 3000) break;
        resources.push({ name: e.name, initiatorType: e.initiatorType, startTime: round(e.startTime), duration: round(e.duration), transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize, protocol: e.nextHopProtocol || undefined, status: e.responseStatus || undefined, renderBlocking: e.renderBlockingStatus && e.renderBlockingStatus !== 'non-blocking' ? e.renderBlockingStatus : undefined });
      }
    } catch { /* ignore */ }
    let navigation;
    try {
      const n = performance.getEntriesByType('navigation')[0];
      if (n) navigation = { type: n.type, protocol: n.nextHopProtocol, transferSize: n.transferSize, encodedBodySize: n.encodedBodySize, decodedBodySize: n.decodedBodySize, responseStart: round(n.responseStart), domContentLoaded: round(n.domContentLoadedEventEnd), loadEventEnd: round(n.loadEventEnd), serverTiming: (n.serverTiming || []).map((s) => ({ name: s.name, duration: s.duration, description: s.description })) };
    } catch { /* ignore */ }
    let paint;
    try { paint = performance.getEntriesByType('paint').map((p) => ({ name: p.name, startTime: round(p.startTime) })); } catch { /* ignore */ }
    return { resources, navigation, paint };
  }
  const SENSITIVE_KEY = /token|secret|password|passwd|auth|session|jwt|api[-_]?key|credential|cookie|csrf/i;
  function collectStorage(includeValues) {
    const readStore = (store) => {
      const out = [];
      try {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          const val = store.getItem(key) || '';
          const rec = { key, size: val.length };
          if (includeValues) rec.value = SENSITIVE_KEY.test(key) ? `***(${val.length} chars, masked)` : clamp(val, 4000);
          out.push(rec);
        }
      } catch (e) { out.push({ error: String(e) }); }
      return out;
    };
    const cookies = [];
    try {
      for (const c of document.cookie.split(';')) {
        const t = c.trim(); if (!t) continue;
        const i = t.indexOf('=');
        const key = i < 0 ? t : t.slice(0, i);
        const val = i < 0 ? '' : t.slice(i + 1);
        const rec = { key, size: val.length };
        if (includeValues) rec.value = SENSITIVE_KEY.test(key) ? `***(${val.length} chars, masked)` : clamp(val, 500);
        cookies.push(rec);
      }
    } catch { /* ignore */ }
    return { localStorage: readStore(localStorage), sessionStorage: readStore(sessionStorage), cookies, includeValues: !!includeValues };
  }

  // ------------------------------------------------------------------ framework hints (isolated side)
  function collectFrameworkHints(styles) {
    const hints = {};
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    let nextData;
    if (nextDataEl) { try { nextData = JSON.parse(nextDataEl.textContent); } catch { nextData = { parseError: true, raw: clamp(nextDataEl.textContent, 200000) }; } }
    const nextScripts = Array.from(document.querySelectorAll('script[src*="/_next/"]')).map((s) => absUrl(s.src));
    let buildId = nextData && nextData.buildId;
    if (!buildId) { for (const s of nextScripts) { const m = s.match(/\/_next\/static\/([^/]+)\/_(?:buildManifest|ssgManifest)\.js/); if (m) { buildId = m[1]; break; } } }
    const hasAppChunks = nextScripts.some((s) => /\/_next\/static\/chunks\/app\//.test(s));
    const hasPagesChunks = nextScripts.some((s) => /\/_next\/static\/chunks\/pages\//.test(s));
    if (nextData || nextScripts.length || document.getElementById('__next') || document.querySelector('next-route-announcer')) {
      hints.next = {
        detected: true,
        buildId: buildId || undefined,
        routerGuess: nextData ? 'pages' : hasAppChunks ? 'app' : hasPagesChunks ? 'pages' : undefined,
        nextData: nextData ? { page: nextData.page, query: nextData.query, buildId: nextData.buildId, locale: nextData.locale, locales: nextData.locales, isFallback: nextData.isFallback, gsp: nextData.gsp, gssp: nextData.gssp, dynamicIds: nextData.dynamicIds, runtimeConfig: nextData.runtimeConfig, propsPreview: clamp(JSON.stringify(nextData.props || {}), 200000) } : undefined,
        scripts: nextScripts.slice(0, 200),
        nextFontPreloads: Array.from(document.querySelectorAll('link[rel="preload"][as="font"]')).map((l) => absUrl(l.href)),
        imageOptimizerUsed: !!document.querySelector('img[src*="/_next/image"], img[srcset*="/_next/image"]'),
      };
    }
    // CSS-in-JS / utility frameworks from stylesheet metadata
    const sheetsText = styles.sheets.map((s) => (s.cssText || '') + (s.inlineText || '')).join('\n');
    const rootVarNames = Object.keys(styles.customProps);
    hints.css = {
      tailwind: rootVarNames.some((n) => n.startsWith('--tw-')) || /tailwindcss/i.test(sheetsText.slice(0, 5000)) || !!document.querySelector('[class*=" md:"], [class^="md:"], [class*=" lg:"], [class*="hover:"]'),
      tailwindV4: rootVarNames.some((n) => /^--(color|font|spacing|radius|breakpoint)-/.test(n)) && /@layer\s+theme|--tw-/.test(sheetsText.slice(0, 20000)),
      emotion: !!document.querySelector('style[data-emotion]'),
      styledComponents: !!document.querySelector('style[data-styled]'),
      cssModules: !!document.querySelector('[class*="_"][class*="__"]') && /\b[A-Za-z]+_[A-Za-z]+__[A-Za-z0-9]{4,}\b/.test(document.body ? document.body.className + ' ' + Array.from(document.body.querySelectorAll('[class]')).slice(0, 300).map((e) => e.className).join(' ') : ''),
      mui: !!document.querySelector('[class*="Mui"]'),
      chakra: !!document.querySelector('[class*="chakra-"]'),
      radix: !!document.querySelector('[data-radix-collection-item], [data-radix-popper-content-wrapper], [data-radix-scroll-area-viewport], [data-radix-aspect-ratio-wrapper]'),
      shadcn: !!document.querySelector('[data-slot]') && rootVarNames.includes('--primary') && rootVarNames.includes('--background'),
      antd: !!document.querySelector('[class*="ant-"]'),
      bootstrap: !!document.querySelector('.container, .container-fluid, .row, .btn') && /bootstrap/i.test(sheetsText.slice(0, 20000)),
      swiper: !!document.querySelector('.swiper, .swiper-container'),
      framerMotionHint: !!document.querySelector('[data-projection-id], [data-framer-appear-id], [style*="transform: translate"][style*="opacity"]'),
      lucideIcons: !!document.querySelector('svg.lucide, svg[class*="lucide"]'),
      heroicons: !!document.querySelector('svg[data-slot="icon"]'),
      fontAwesome: !!document.querySelector('[class*="fa-"], svg[data-prefix]'),
      googleFonts: Array.from(document.querySelectorAll('link[href*="fonts.googleapis.com"]')).map((l) => absUrl(l.href)),
    };
    hints.vue = !!document.querySelector('[data-v-app], [data-server-rendered="true"]') || undefined;
    hints.angular = (document.querySelector('[ng-version]') || {}).getAttribute ? document.querySelector('[ng-version]').getAttribute('ng-version') : undefined;
    hints.svelte = !!document.querySelector('[class*="svelte-"]') || undefined;
    hints.astro = !!document.querySelector('astro-island') || undefined;
    hints.qwik = !!document.querySelector('[q\\:container]') || undefined;
    hints.gatsby = !!document.getElementById('___gatsby') || undefined;
    hints.remix = Array.from(document.scripts).some((s) => /__remixContext/.test(s.textContent || '')) || undefined;
    hints.nuxt = !!document.getElementById('__nuxt') || undefined;
    hints.wordpress = !!document.querySelector('link[href*="/wp-content/"], script[src*="/wp-content/"], meta[name="generator"][content*="WordPress"]') || undefined;
    hints.generator = (document.querySelector('meta[name="generator"]') || {}).content || undefined;
    return hints;
  }

  // ------------------------------------------------------------------ design tokens
  function analyzeTokens(elements) {
    const count = (map, key) => { if (key == null || key === '') return; map.set(key, (map.get(key) || 0) + 1); };
    const colors = new Map(), colorUse = new Map();
    const families = new Map(), sizes = new Map(), weights = new Map(), lineHeights = new Map(), letterSpacings = new Map();
    const radii = new Map(), shadows = new Map(), zIndexes = new Map(), gaps = new Map(), paddings = new Map(), margins = new Map(), maxWidths = new Map(), gradients = new Map(), borders = new Map(), transitionsMap = new Map(), fontStacks = new Map();
    const isColorTransparent = (v) => !v || v === 'transparent' || v === 'rgba(0, 0, 0, 0)';
    for (const el of elements) {
      if (!el.visible) continue;
      const addColor = (v, use) => { if (isColorTransparent(v) || v === 'currentcolor' || v === 'none') return; const hex = colorToHex(v); count(colors, hex); const key = `${hex}|${use}`; count(colorUse, key); };
      // text tokens: effective values of text-bearing elements (inheritance-independent)
      if (el.fx) {
        addColor(el.fx.color, 'text');
        count(fontStacks, el.fx.stack); count(families, el.fx.family);
        count(sizes, el.fx.size); count(weights, el.fx.weight); count(lineHeights, el.fx.lineHeight); count(letterSpacings, el.fx.letterSpacing);
      }
      if (!el.styles) continue;
      const s = el.styles;
      if (s['background-color']) addColor(s['background-color'], 'background');
      for (const side of ['top', 'right', 'bottom', 'left']) { const w = s[`border-${side}-width`]; const c = s[`border-${side}-color`]; if (w && w !== '0px' && c) addColor(c, 'border'); }
      if (s.fill) addColor(s.fill, 'fill');
      if (s.stroke) addColor(s.stroke, 'stroke');
      if (s['outline-color'] && s['outline-style'] && s['outline-style'] !== 'none') addColor(s['outline-color'], 'outline');
      if (s['text-decoration-color'] && s['text-decoration-line'] && s['text-decoration-line'] !== 'none') addColor(s['text-decoration-color'], 'decoration');
      for (const c of ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius']) if (s[c] && s[c] !== '0px') count(radii, s[c]);
      if (s['box-shadow'] && s['box-shadow'] !== 'none') count(shadows, s['box-shadow']);
      if (s['z-index'] && s['z-index'] !== 'auto') count(zIndexes, s['z-index']);
      for (const g of ['gap', 'row-gap', 'column-gap']) if (s[g] && s[g] !== 'normal' && s[g] !== '0px') count(gaps, s[g]);
      for (const p of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']) if (s[p] && s[p] !== '0px') count(paddings, s[p]);
      for (const p of ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']) if (s[p] && s[p] !== '0px') count(margins, s[p]);
      if (s['max-width'] && s['max-width'] !== 'none') count(maxWidths, s['max-width']);
      if (s['background-image'] && /gradient\(/.test(s['background-image'])) count(gradients, s['background-image']);
      if (s['border-top-width'] && s['border-top-width'] !== '0px' && s['border-top-style'] && s['border-top-style'] !== 'none') count(borders, `${s['border-top-width']} ${s['border-top-style']} ${colorToHex(s['border-top-color'] || '')}`);
      if (s['transition-duration'] && s['transition-duration'] !== '0s') count(transitionsMap, `${s['transition-property'] || 'all'} ${s['transition-duration']} ${s['transition-timing-function'] || ''}`.trim());
    }
    const top = (map, n = 60, sortNumeric = false) => {
      let arr = Array.from(map, ([value, c]) => ({ value, count: c }));
      arr.sort((a, b) => b.count - a.count);
      arr = arr.slice(0, n);
      if (sortNumeric) arr.sort((a, b) => parseFloat(a.value) - parseFloat(b.value));
      return arr;
    };
    const colorsWithUse = top(colors, 80).map((c) => ({ ...c, uses: ['text', 'background', 'border', 'fill', 'stroke', 'outline', 'decoration'].filter((u) => colorUse.has(`${c.value}|${u}`)).map((u) => `${u}:${colorUse.get(`${c.value}|${u}`)}`) }));
    return {
      colors: colorsWithUse,
      fontFamilies: top(families, 20), fontStacks: top(fontStacks, 20), fontSizes: top(sizes, 30, true), fontWeights: top(weights, 10, true), lineHeights: top(lineHeights, 20), letterSpacings: top(letterSpacings, 15),
      radii: top(radii, 15, true), shadows: top(shadows, 15), zIndexes: top(zIndexes, 20, true), gaps: top(gaps, 15, true), paddings: top(paddings, 25, true), margins: top(margins, 25, true), maxWidths: top(maxWidths, 15, true), gradients: top(gradients, 20), borders: top(borders, 20), transitions: top(transitionsMap, 20),
    };
  }

  // ------------------------------------------------------------------ orchestration
  async function collectAll(opts = {}) {
    const t0 = performance.now();
    const timings = {};
    const mark = (k, from) => { timings[k] = Math.round(performance.now() - from); };
    let ann;
    const result = { collectorVersion: SC.version, options: opts };
    try {
      let t = performance.now();
      ann = annotateAll();
      result.meta = collectMeta();
      result.head = collectHead();
      result.html = serializeDocument(ann.shadowHosts);
      mark('snapshot', t);

      t = performance.now();
      const elc = collectElements(ann.ids, opts);
      result.elements = elc.elements;
      result.elementStats = { ...elc.stats, annotated: ann.count, shadowRoots: SC._shadowRoots.length };
      mark('elements', t);

      t = performance.now();
      result.styles = collectStyles();
      result.fonts = collectFonts(result.elements);
      mark('styles', t);

      t = performance.now();
      result.assets = collectAssets(ann.ids, elc.bgImages);
      result.links = collectLinks(ann.ids);
      result.scripts = collectScripts(ann.ids);
      result.structure = collectStructure(ann.ids);
      result.forms = collectForms(ann.ids);
      result.interactive = collectInteractive(elc.interactiveCandidates, ann.ids);
      result.animations = { css: elc.animated, transitions: elc.transitions, webAnimations: collectWebAnimations(ann.ids), keyframes: result.styles.keyframes.map((k) => k.name) };
      result.performance = collectPerformance();
      result.storage = collectStorage(!!opts.storageValues);
      result.tokens = analyzeTokens(result.elements);
      result.frameworkHints = collectFrameworkHints(result.styles);
      mark('misc', t);

      // MAIN-world data (framework globals, React tree, network log, RSC flight)
      t = performance.now();
      result.hook = { present: false };
      if (await hookPresent()) {
        result.hook.present = true;
        try { result.hook.detect = await hookRequest('detect', {}); } catch (e) { result.hook.detectError = String(e); }
        if (opts.react !== false) {
          try {
            const tree = await hookRequest('react-tree', { maxDepth: opts.reactMaxDepth || 400, maxNodes: opts.reactMaxNodes || 40000 }, 60000);
            result.hook.react = tree;
            if (tree && tree.ownerMap) {
              const byId = new Map(result.elements.map((e) => [e.id, e]));
              for (const [id, owners] of Object.entries(tree.ownerMap)) { const e = byId.get(Number(id)); if (e) e.component = owners; }
              for (const [id, handlers] of Object.entries(tree.handlers || {})) { const e = byId.get(Number(id)); if (e) e.events = handlers; }
              const inter = new Map(result.interactive.map((i) => [i.id, i]));
              for (const [id, handlers] of Object.entries(tree.handlers || {})) { const i = inter.get(Number(id)); if (i) i.reactHandlers = handlers; }
            }
          } catch (e) { result.hook.reactError = String(e); }
        }
        if (opts.network !== false) { try { result.hook.network = await hookRequest('network', {}); } catch (e) { result.hook.networkError = String(e); } }
        try { result.hook.flight = await hookRequest('next-flight', { maxChars: opts.flightMaxChars || 3_000_000 }); } catch (e) { result.hook.flightError = String(e); }
        try { result.hook.console = await hookRequest('console', {}); } catch { /* ignore */ }
      }
      mark('hook', t);
    } finally {
      try { removeAnnotations(); } catch { /* ignore */ }
      releaseDefaults();
    }
    timings.total = Math.round(performance.now() - t0);
    result.timings = timings;
    // Split into parts so the dashboard can pull them without hitting message-size limits.
    const parts = {};
    const partNames = ['html', 'elements', 'styles', 'assets', 'scripts', 'hook'];
    for (const name of partNames) { parts[name] = JSON.stringify(result[name] === undefined ? null : result[name]); delete result[name]; }
    parts.core = JSON.stringify(result);
    SC.parts = parts;
    const manifest = {};
    for (const [k, v] of Object.entries(parts)) manifest[k] = v.length;
    return { parts: manifest, timings };
  }

  // ------------------------------------------------------------------ screenshot helpers
  const shot = { active: false, scroller: null, isWindow: true, origX: 0, origY: 0, styleEl: null, hidden: new Map(), fixed: [], sticky: [], viewportH: 0 };
  function findScroller() {
    const se = document.scrollingElement || document.documentElement;
    const htmlOv = getComputedStyle(document.documentElement).overflowY;
    const bodyOv = document.body ? getComputedStyle(document.body).overflowY : 'visible';
    const docScrollable = se.scrollHeight > window.innerHeight + 1 && htmlOv !== 'hidden' && !(bodyOv === 'hidden' && htmlOv === 'visible' && document.compatMode === 'CSS1Compat' && se === document.documentElement && bodyOv === 'hidden');
    if (docScrollable) return { el: se, isWindow: true };
    // Look for the tallest inner scroll container.
    let best = null, bestDelta = 0;
    for (const el of document.querySelectorAll('body, body *')) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(cs.overflowY)) continue;
      const delta = el.scrollHeight - el.clientHeight;
      if (delta > bestDelta && el.clientHeight >= window.innerHeight * 0.4) { best = el; bestDelta = delta; }
    }
    if (best) return { el: best, isWindow: false };
    return { el: se, isWindow: true };
  }
  function setHidden(el, hidden) {
    if (hidden) {
      if (shot.hidden.has(el)) return;
      shot.hidden.set(el, { value: el.style.getPropertyValue('visibility'), priority: el.style.getPropertyPriority('visibility') });
      el.style.setProperty('visibility', 'hidden', 'important');
    } else if (shot.hidden.has(el)) {
      const o = shot.hidden.get(el);
      shot.hidden.delete(el);
      if (o.value) el.style.setProperty('visibility', o.value, o.priority); else el.style.removeProperty('visibility');
    }
  }
  function shotPrepare() {
    if (shot.active) shotRestore();
    const { el, isWindow } = findScroller();
    shot.active = true; shot.scroller = el; shot.isWindow = isWindow;
    shot.origX = isWindow ? window.scrollX : el.scrollLeft;
    shot.origY = isWindow ? window.scrollY : el.scrollTop;
    const style = document.createElement('style');
    style.setAttribute('data-sc-internal', '1');
    style.textContent = 'html, body, * { scroll-behavior: auto !important; }';
    document.documentElement.appendChild(style);
    shot.styleEl = style;
    const vh = window.innerHeight;
    shot.viewportH = vh;
    shot.fixed = []; shot.sticky = [];
    for (const e of document.querySelectorAll('body *')) {
      if (e.hasAttribute('data-sc-internal')) continue;
      const cs = getComputedStyle(e);
      if (cs.position === 'fixed') {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || cs.display === 'none' || cs.visibility === 'hidden') continue;
        const center = r.top + r.height / 2;
        shot.fixed.push({ el: e, anchor: center < vh / 2 ? 'top' : 'bottom', rect: viewportRectOf(e), path: cssPath(e) });
      } else if (cs.position === 'sticky') {
        shot.sticky.push({ el: e, top: parseFloat(cs.top) || 0, path: cssPath(e) });
      }
    }
    // Sticky elements: render at their natural in-flow position for every frame (position: relative, offsets reset),
    // so they neither duplicate nor get cut at frame boundaries. Restored in shotRestore().
    for (const s of shot.sticky) {
      const st = s.el.style;
      s.saved = ['position', 'top', 'bottom', 'left', 'right'].map((p) => [p, st.getPropertyValue(p), st.getPropertyPriority(p)]);
      st.setProperty('position', 'relative', 'important');
      for (const p of ['top', 'bottom', 'left', 'right']) st.setProperty(p, 'auto', 'important');
    }
    const rect = isWindow ? { top: 0, left: 0, width: window.innerWidth, height: vh } : viewportRectOf(el);
    const scrollHeight = isWindow ? Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) : el.scrollHeight;
    return {
      isWindow, scrollerPath: cssPath(el), scrollerRect: rect,
      scrollHeight, scrollWidth: isWindow ? Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) : el.scrollWidth,
      viewportWidth: window.innerWidth, viewportHeight: vh, dpr: window.devicePixelRatio,
      fixed: shot.fixed.map((f) => ({ anchor: f.anchor, rect: f.rect, path: f.path })),
      sticky: shot.sticky.map((s) => ({ top: s.top, path: s.path })),
    };
  }
  async function shotScrollTo({ y, frameIndex, isLast, settleMs = 250 }) {
    if (!shot.active) shotPrepare();
    const { scroller, isWindow } = shot;
    if (isWindow) window.scrollTo(0, y); else scroller.scrollTop = y;
    await raf(); await raf();
    await sleep(settleMs);
    // lazy images inside the viewport
    const deadline = performance.now() + 1500;
    while (performance.now() < deadline) {
      const pending = Array.from(document.images).filter((img) => { if (img.complete) return false; const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight && r.width > 0; });
      if (!pending.length) break;
      await sleep(120);
    }
    // fixed / sticky handling
    for (const f of shot.fixed) {
      const show = f.anchor === 'top' ? frameIndex === 0 : !!isLast;
      setHidden(f.el, !show);
    }
    await raf();
    const actualY = isWindow ? window.scrollY : scroller.scrollTop;
    return { y: actualY, innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio };
  }
  function shotRestore() {
    if (!shot.active) return { ok: true };
    for (const el of Array.from(shot.hidden.keys())) setHidden(el, false);
    for (const s of shot.sticky) {
      if (!s.saved) continue;
      try { for (const [p, v, pr] of s.saved) { if (v) s.el.style.setProperty(p, v, pr); else s.el.style.removeProperty(p); } } catch { /* ignore */ }
      s.saved = null;
    }
    if (shot.styleEl) { try { shot.styleEl.remove(); } catch { /* ignore */ } }
    try { if (shot.isWindow) window.scrollTo(shot.origX, shot.origY); else { shot.scroller.scrollTop = shot.origY; shot.scroller.scrollLeft = shot.origX; } } catch { /* ignore */ }
    shot.active = false; shot.styleEl = null; shot.fixed = []; shot.sticky = []; shot.scroller = null;
    return { ok: true };
  }
  function viewportInfo() {
    return { innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight, dpr: window.devicePixelRatio, scrollHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0), url: location.href, title: document.title, readyState: document.readyState };
  }
  async function waitIdle({ maxMs = 8000, quietMs = 700 } = {}) {
    const start = performance.now();
    if (document.readyState !== 'complete') {
      await new Promise((r) => { window.addEventListener('load', r, { once: true }); setTimeout(r, maxMs); });
    }
    try { await Promise.race([document.fonts.ready, sleep(3000)]); } catch { /* ignore */ }
    let last = performance.getEntriesByType('resource').length;
    let lastChange = performance.now();
    while (performance.now() - start < maxMs) {
      await sleep(150);
      const c = performance.getEntriesByType('resource').length;
      if (c !== last) { last = c; lastChange = performance.now(); }
      else if (performance.now() - lastChange >= quietMs) break;
    }
    return { readyState: document.readyState, resources: last, waitedMs: Math.round(performance.now() - start), url: location.href, title: document.title };
  }
  async function scrollThrough({ step, settleMs = 150, maxMs = 20000 } = {}) {
    // Scroll through the page once to trigger lazy loading / in-view animations, then return to top.
    const { el, isWindow } = findScroller();
    const h = isWindow ? Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) : el.scrollHeight;
    const s = step || Math.max(200, Math.floor(window.innerHeight * 0.8));
    const start = performance.now();
    const origY = isWindow ? window.scrollY : el.scrollTop;
    for (let y = 0; y < h && performance.now() - start < maxMs; y += s) {
      if (isWindow) window.scrollTo(0, y); else el.scrollTop = y;
      await raf(); await sleep(settleMs);
    }
    if (isWindow) window.scrollTo(0, origY); else el.scrollTop = origY;
    await raf();
    return { height: h, step: s, ms: Math.round(performance.now() - start) };
  }

  // ------------------------------------------------------------------ message handling
  async function handle(msg) {
    switch (msg.cmd) {
      case 'ping': return { collector: SC.version, url: location.href, title: document.title, readyState: document.readyState };
      case 'hook:ping': return { present: await hookPresent() };
      case 'hook': return hookRequest(msg.hookCmd, msg.args || {}, msg.timeoutMs || 30000);
      case 'viewport': return viewportInfo();
      case 'waitIdle': return waitIdle(msg);
      case 'scrollThrough': return scrollThrough(msg);
      case 'collect': return collectAll(msg.opts || {});
      case 'part': {
        const text = SC.parts && SC.parts[msg.name];
        if (text == null) throw new Error(`unknown part: ${msg.name}`);
        const offset = msg.offset || 0;
        const length = msg.length || 4_000_000;
        return { text: text.slice(offset, offset + length), total: text.length, done: offset + length >= text.length };
      }
      case 'releaseParts': SC.parts = null; return { ok: true };
      case 'shot:prepare': return shotPrepare();
      case 'shot:scrollTo': return shotScrollTo(msg);
      case 'shot:restore': return shotRestore();
      default: throw new Error(`unknown command: ${msg.cmd}`);
    }
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.__sc !== true) return false;
    Promise.resolve()
      .then(() => handle(msg))
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.stack) || e) }));
    return true;
  });
})();
