/* Site Clone Collector — page hook (MAIN world).
 *
 * Runs inside the page's own JavaScript world so it can see framework globals,
 * React fiber internals and wrap fetch/XHR. Injected either on demand
 * (chrome.scripting.executeScript world:'MAIN') or at document_start via a
 * dynamically registered content script when "record from page load" is enabled.
 *
 * Talks to the isolated-world collector through DOM CustomEvents carrying JSON strings:
 *   'sc:req' {id, cmd, args}  ->  'sc:res' {id, ok, data | error}
 */
(() => {
  'use strict';
  if (window.__SC_HOOK__) return;
  const H = (window.__SC_HOOK__ = { version: '0.1.0', installedAt: Date.now(), net: [], sockets: [], beacons: [], errors: [], maxNet: 1000 });

  const MAX_BODY = 300_000;
  const SENSITIVE_HEADER = /authorization|cookie|token|secret|api[-_]?key|session|x-csrf/i;
  const TEXT_CT = /json|text|xml|javascript|x-component|x-www-form-urlencoded|graphql|html|csv|yaml|rsc/i;
  const clamp = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + `…[+${s.length - n}]` : s);
  let seq = 0;

  function abs(u) { try { return new URL(String(u), location.href).href; } catch { return String(u); } }
  function newRec(kind) {
    const rec = { id: ++seq, kind, ts: Date.now(), tRel: Math.round(performance.now()), page: location.href };
    H.net.push(rec);
    if (H.net.length > H.maxNet) H.net.shift();
    return rec;
  }
  function headersToObj(h) {
    const out = {};
    try {
      if (!h) return out;
      const entries = typeof h.entries === 'function' ? h.entries() : Array.isArray(h) ? h : Object.entries(h);
      for (const [k, v] of entries) out[String(k)] = SENSITIVE_HEADER.test(k) ? '***' : clamp(String(v), 300);
    } catch { /* ignore */ }
    return out;
  }
  function pickResHeaders(h) {
    const out = {};
    try { for (const [k, v] of h.entries()) if (/^(content-type|content-length|cache-control|content-encoding|etag|x-vercel-cache|x-nextjs-cache|x-vercel-id|x-powered-by|server|age|vary|x-matched-path|x-middleware-rewrite|rsc|next-router-state-tree)$/i.test(k)) out[k] = clamp(v, 300); } catch { /* ignore */ }
    return out;
  }
  function bodyPreview(body) {
    try {
      if (body == null) return undefined;
      if (typeof body === 'string') return clamp(body, 20_000);
      if (body instanceof URLSearchParams) return clamp(body.toString(), 20_000);
      if (typeof FormData !== 'undefined' && body instanceof FormData) { const o = {}; for (const [k, v] of body.entries()) o[k] = typeof v === 'string' ? clamp(v, 2000) : `<file ${v.name || ''} ${v.size || 0}B>`; return { formData: o }; }
      if (body instanceof Blob) return `<blob ${body.type} ${body.size}B>`;
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `<binary ${body.byteLength}B>`;
      if (typeof body === 'object' && typeof body.getReader === 'function') return '<stream>';
      return clamp(String(body), 2000);
    } catch { return '<unreadable>'; }
  }
  function captureResponseBody(res, rec) {
    try {
      const ct = res.headers.get('content-type') || '';
      const len = parseInt(res.headers.get('content-length') || '0', 10);
      if (!TEXT_CT.test(ct) && ct) { rec.resBodySkipped = `content-type ${ct}`; return; }
      if (len > MAX_BODY * 4) { rec.resBodySkipped = `too large (${len}B)`; return; }
      res.clone().text().then((t) => { rec.resSize = t.length; rec.resBody = clamp(t, MAX_BODY); }).catch((e) => { rec.resBodyError = String(e); });
    } catch (e) { rec.resBodyError = String(e); }
  }

  // ---------------------------------------------------------------- fetch
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function scFetch(input, init) {
      const rec = newRec('fetch');
      try {
        const req = typeof Request !== 'undefined' && input instanceof Request ? input : null;
        rec.url = abs(req ? req.url : String(input));
        rec.method = String((init && init.method) || (req && req.method) || 'GET').toUpperCase();
        const hdrs = (init && init.headers) || (req && req.headers);
        if (hdrs) rec.reqHeaders = headersToObj(hdrs);
        if (init && init.body != null) rec.reqBody = bodyPreview(init.body);
        rec.stack = clamp(String(new Error().stack || '').split('\n').slice(2, 6).join('\n'), 1000);
      } catch { /* ignore */ }
      let p;
      try { p = origFetch.apply(this, arguments); } catch (e) { rec.error = String(e); throw e; }
      p.then((res) => {
        rec.status = res.status; rec.ok = res.ok; rec.duration = Math.round(performance.now()) - rec.tRel;
        rec.resHeaders = pickResHeaders(res.headers); rec.redirected = res.redirected || undefined; rec.finalUrl = res.url !== rec.url ? res.url : undefined;
        captureResponseBody(res, rec);
      }, (err) => { rec.error = String(err); rec.duration = Math.round(performance.now()) - rec.tRel; });
      return p;
    };
    try { window.fetch.toString = () => 'function fetch() { [native code] }'; } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- XHR
  if (typeof XMLHttpRequest !== 'undefined') {
    const XP = XMLHttpRequest.prototype;
    const oOpen = XP.open, oSend = XP.send, oSet = XP.setRequestHeader;
    XP.open = function (method, url) {
      try { this.__sc = { method: String(method).toUpperCase(), url: abs(url) }; } catch { /* ignore */ }
      return oOpen.apply(this, arguments);
    };
    XP.setRequestHeader = function (k, v) {
      try { if (this.__sc) (this.__sc.reqHeaders || (this.__sc.reqHeaders = {}))[k] = SENSITIVE_HEADER.test(k) ? '***' : clamp(String(v), 300); } catch { /* ignore */ }
      return oSet.apply(this, arguments);
    };
    XP.send = function (body) {
      try {
        const info = this.__sc || {};
        const rec = newRec('xhr');
        Object.assign(rec, info);
        rec.reqBody = bodyPreview(body);
        const xhr = this;
        xhr.addEventListener('loadend', () => {
          try {
            rec.status = xhr.status; rec.duration = Math.round(performance.now()) - rec.tRel;
            const raw = xhr.getAllResponseHeaders() || '';
            const rh = {};
            for (const line of raw.trim().split(/[\r\n]+/)) { const i = line.indexOf(':'); if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(); if (/^(content-type|content-length|cache-control|etag|x-vercel-cache|x-nextjs-cache|server)$/.test(k)) rh[k] = clamp(line.slice(i + 1).trim(), 300); } }
            rec.resHeaders = rh;
            rec.finalUrl = xhr.responseURL && xhr.responseURL !== rec.url ? xhr.responseURL : undefined;
            if (xhr.responseType === '' || xhr.responseType === 'text') { const t = String(xhr.responseText || ''); rec.resSize = t.length; rec.resBody = clamp(t, MAX_BODY); }
            else if (xhr.responseType === 'json') { const t = JSON.stringify(xhr.response); rec.resSize = t ? t.length : 0; rec.resBody = clamp(t || '', MAX_BODY); }
            else rec.resBodySkipped = `responseType ${xhr.responseType}`;
          } catch (e) { rec.resBodyError = String(e); }
        });
      } catch { /* ignore */ }
      return oSend.apply(this, arguments);
    };
  }

  // ---------------------------------------------------------------- WebSocket / EventSource / sendBeacon
  function wrapCtor(name, kind) {
    const Orig = window[name];
    if (typeof Orig !== 'function') return;
    const Wrapped = function (url, arg2) {
      try { H.sockets.push({ kind, url: abs(url), ts: Date.now(), page: location.href }); if (H.sockets.length > 200) H.sockets.shift(); } catch { /* ignore */ }
      return arg2 === undefined ? new Orig(url) : new Orig(url, arg2);
    };
    Wrapped.prototype = Orig.prototype;
    try { Object.setPrototypeOf(Wrapped, Orig); } catch { /* ignore */ }
    for (const k of Object.getOwnPropertyNames(Orig)) { if (!(k in Wrapped)) { try { Wrapped[k] = Orig[k]; } catch { /* ignore */ } } }
    try { window[name] = Wrapped; } catch { /* ignore */ }
  }
  wrapCtor('WebSocket', 'websocket');
  wrapCtor('EventSource', 'eventsource');
  if (navigator.sendBeacon) {
    const oBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      try { H.beacons.push({ url: abs(url), size: data ? (data.size || data.byteLength || String(data).length) : 0, ts: Date.now() }); if (H.beacons.length > 200) H.beacons.shift(); } catch { /* ignore */ }
      return oBeacon(url, data);
    };
  }

  // ---------------------------------------------------------------- console / errors
  const oError = console.error;
  console.error = function () { try { H.errors.push({ kind: 'console.error', ts: Date.now(), message: clamp(Array.from(arguments).map((a) => { try { return typeof a === 'string' ? a : a && a.stack ? a.stack : JSON.stringify(a); } catch { return String(a); } }).join(' '), 2000) }); if (H.errors.length > 200) H.errors.shift(); } catch { /* ignore */ } return oError.apply(this, arguments); };
  window.addEventListener('error', (e) => { try { H.errors.push({ kind: 'error', ts: Date.now(), message: clamp(String(e.message), 2000), source: e.filename, line: e.lineno }); if (H.errors.length > 200) H.errors.shift(); } catch { /* ignore */ } });
  window.addEventListener('unhandledrejection', (e) => { try { H.errors.push({ kind: 'unhandledrejection', ts: Date.now(), message: clamp(String((e.reason && (e.reason.stack || e.reason.message)) || e.reason), 2000) }); if (H.errors.length > 200) H.errors.shift(); } catch { /* ignore */ } });

  // ---------------------------------------------------------------- detection
  function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
  function customGlobals() {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.setAttribute('data-sc-internal', '1');
      (document.body || document.documentElement).appendChild(iframe);
      const base = new Set(Object.getOwnPropertyNames(iframe.contentWindow));
      iframe.remove();
      const own = Object.getOwnPropertyNames(window).filter((k) => !base.has(k) && k !== '__SC_HOOK__');
      return own.slice(0, 400).map((k) => { let t = 'unknown'; try { const v = window[k]; t = v === null ? 'null' : typeof v === 'function' ? 'function' : Array.isArray(v) ? `array(${v.length})` : typeof v === 'object' ? `object(${Object.keys(v).slice(0, 6).join(',')})` : typeof v; } catch { /* ignore */ } return { name: k, type: t }; });
    } catch { return []; }
  }
  function detect() {
    const w = window;
    const next = w.next || {};
    const out = {
      next: (w.__NEXT_DATA__ || w.__next_f || w.next || w.__NEXT_P || document.getElementById('__next')) ? {
        version: next.version || undefined,
        appDir: next.appDir === true ? true : undefined,
        router: w.__NEXT_DATA__ ? 'pages' : (next.appDir || Array.isArray(w.__next_f)) ? 'app' : undefined,
        hasNextData: !!w.__NEXT_DATA__,
        hasFlightData: Array.isArray(w.__next_f),
        flightChunks: Array.isArray(w.__next_f) ? w.__next_f.length : 0,
        buildId: safe(() => w.__NEXT_DATA__ && w.__NEXT_DATA__.buildId),
        routerState: safe(() => next.router && next.router.state ? { pathname: next.router.state.pathname, asPath: next.router.state.asPath, query: next.router.state.query, locale: next.router.state.locale } : (next.router ? { pathname: next.router.pathname, asPath: next.router.asPath, query: next.router.query, locale: next.router.locale } : undefined)),
      } : undefined,
      react: detectReact(),
      vue: safe(() => (w.__VUE__ ? { detected: true } : (document.querySelector('[data-v-app]') && { detected: true, hint: 'data-v-app' })) || undefined),
      nuxt: safe(() => (w.__NUXT__ ? { detected: true, config: w.__NUXT__.config ? Object.keys(w.__NUXT__.config) : undefined } : undefined)),
      angular: safe(() => { const el = document.querySelector('[ng-version]'); return el ? { version: el.getAttribute('ng-version') } : undefined; }),
      svelte: safe(() => (document.querySelector('[class*="svelte-"]') ? { detected: true } : undefined)),
      remix: safe(() => (w.__remixContext ? { detected: true, routes: Object.keys((w.__remixManifest && w.__remixManifest.routes) || {}).slice(0, 100) } : undefined)),
      gatsby: safe(() => (w.___gatsby || document.getElementById('___gatsby') ? { detected: true } : undefined)),
      astro: safe(() => (document.querySelector('astro-island') ? { detected: true } : undefined)),
      jquery: safe(() => (w.jQuery && w.jQuery.fn ? { version: w.jQuery.fn.jquery } : undefined)),
      gsap: safe(() => (w.gsap ? { version: w.gsap.version } : undefined)),
      three: safe(() => (w.THREE ? { revision: w.THREE.REVISION } : undefined)),
      lenis: safe(() => (w.Lenis || w.lenis ? { detected: true } : undefined)),
      swiper: safe(() => (w.Swiper ? { detected: true } : undefined)),
      analytics: safe(() => {
        const a = {};
        if (w.gtag) a.gtag = true;
        if (w.ga) a.ga = true;
        if (Array.isArray(w.dataLayer)) a.dataLayer = w.dataLayer.length;
        if (w.google_tag_manager) a.gtm = Object.keys(w.google_tag_manager).filter((k) => /^(GTM|G|UA|AW)-/.test(k));
        if (w.fbq) a.fbq = true;
        if (w.hj) a.hotjar = true;
        if (w.amplitude) a.amplitude = true;
        if (w.mixpanel) a.mixpanel = true;
        if (w.posthog) a.posthog = true;
        if (w.Sentry) a.sentry = true;
        if (w.Intercom) a.intercom = true;
        if (w.$crisp) a.crisp = true;
        if (w.ChannelIO) a.channelio = true;
        if (w.Kakao) a.kakao = safe(() => w.Kakao.VERSION, true);
        if (w.wcs || w.wcs_add) a.naverAnalytics = true;
        if (w.naver && w.naver.maps) a.naverMaps = true;
        if (w.kakao && w.kakao.maps) a.kakaoMaps = true;
        if (w.IMP) a.portone = true;
        if (w.TossPayments) a.tossPayments = true;
        if (w.Stripe) a.stripe = true;
        if (w.clarity) a.clarity = true;
        if (w.va || w.vaq) a.vercelAnalytics = true;
        if (w.si || w.siq) a.vercelSpeedInsights = true;
        return Object.keys(a).length ? a : undefined;
      }),
      globals: customGlobals(),
      documentReadyState: document.readyState,
      hookInstalledAt: H.installedAt,
      recordedSince: new Date(H.installedAt).toISOString(),
    };
    return out;
  }

  // ---------------------------------------------------------------- React fiber walking
  const SYM = (n) => { try { return Symbol.for(n); } catch { return undefined; } };
  const S_MEMO = SYM('react.memo'), S_FWD = SYM('react.forward_ref'), S_PROVIDER = SYM('react.provider'), S_CONTEXT = SYM('react.context'), S_LAZY = SYM('react.lazy'), S_FRAGMENT = SYM('react.fragment'), S_SUSPENSE = SYM('react.suspense'), S_PROFILER = SYM('react.profiler'), S_STRICT = SYM('react.strict_mode'), S_CONSUMER = SYM('react.consumer');
  const TAG_NAMES = { 0: 'FunctionComponent', 1: 'ClassComponent', 2: 'IndeterminateComponent', 3: 'HostRoot', 4: 'HostPortal', 5: 'HostComponent', 6: 'HostText', 7: 'Fragment', 8: 'Mode', 9: 'ContextConsumer', 10: 'ContextProvider', 11: 'ForwardRef', 12: 'Profiler', 13: 'Suspense', 14: 'MemoComponent', 15: 'SimpleMemoComponent', 16: 'LazyComponent', 17: 'IncompleteClassComponent', 18: 'DehydratedFragment', 19: 'SuspenseList', 21: 'Scope', 22: 'Offscreen', 23: 'LegacyHidden', 24: 'Cache', 25: 'TracingMarker', 26: 'HostHoistable', 27: 'HostSingleton', 28: 'IncompleteFunctionComponent', 29: 'Throw', 30: 'ViewTransition', 31: 'Activity' };
  function typeName(t) {
    if (t == null) return '';
    if (typeof t === 'string') return t;
    if (typeof t === 'function') return t.displayName || t.name || 'Anonymous';
    if (typeof t === 'object') {
      const $$ = t.$$typeof;
      if ($$ === S_MEMO) return `Memo(${typeName(t.type)})`;
      if ($$ === S_FWD) return `ForwardRef(${(t.render && (t.render.displayName || t.render.name)) || t.displayName || ''})`;
      if ($$ === S_PROVIDER) return `${(t._context && t._context.displayName) || 'Context'}.Provider`;
      if ($$ === S_CONTEXT) return `${t.displayName || 'Context'}.Provider`;
      if ($$ === S_CONSUMER) return `${(t._context && t._context.displayName) || 'Context'}.Consumer`;
      if ($$ === S_LAZY) return 'Lazy';
      if (t.displayName) return String(t.displayName);
    }
    if (t === S_FRAGMENT) return 'Fragment';
    if (t === S_SUSPENSE) return 'Suspense';
    if (t === S_PROFILER) return 'Profiler';
    if (t === S_STRICT) return 'StrictMode';
    return '';
  }
  function fiberName(f) {
    const n = typeName(f.type) || typeName(f.elementType);
    if (n) return n;
    return TAG_NAMES[f.tag] || `Unknown(${f.tag})`;
  }
  function fiberKind(f) {
    switch (f.tag) {
      case 5: case 26: case 27: return 'host';
      case 6: return 'text';
      case 3: return 'root';
      case 4: return 'portal';
      case 0: case 1: case 2: case 11: case 14: case 15: case 16: case 28: return 'component';
      case 7: case 8: case 9: case 10: case 12: case 13: case 19: case 21: case 22: case 23: case 24: case 25: case 30: case 31: return 'internal';
      default: return typeof f.type === 'function' || (f.type && typeof f.type === 'object') ? 'component' : 'internal';
    }
  }
  function summarizeProps(props, max = 40) {
    const out = {};
    if (!props || typeof props !== 'object') return out;
    let n = 0;
    for (const k of Object.keys(props)) {
      if (k === 'children') { const c = props.children; out.children = Array.isArray(c) ? `[${c.length}]` : typeof c === 'string' ? clamp(c, 80) : c == null ? undefined : (c && c.$$typeof) ? '<Element>' : typeof c; continue; }
      if (n++ >= max) { out['…'] = `+${Object.keys(props).length - max} more`; break; }
      const v = props[k];
      try {
        if (v == null) out[k] = v;
        else if (typeof v === 'string') out[k] = clamp(v, 160);
        else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
        else if (typeof v === 'function') out[k] = `ƒ ${v.name || ''}`.trim();
        else if (Array.isArray(v)) out[k] = `[${v.length}]${v.length && typeof v[0] !== 'object' ? ' ' + clamp(JSON.stringify(v.slice(0, 5)), 120) : ''}`;
        else if (v.$$typeof) out[k] = '<Element>';
        else if (v instanceof Element) out[k] = `<${v.localName}>`;
        else if (typeof v === 'object') { const keys = Object.keys(v); out[k] = keys.length <= 6 && keys.every((kk) => typeof v[kk] !== 'object' || v[kk] === null) ? clamp(JSON.stringify(v), 200) : `{${keys.slice(0, 8).join(',')}${keys.length > 8 ? ',…' : ''}}`; }
        else out[k] = typeof v;
      } catch { out[k] = '<unserializable>'; }
    }
    return out;
  }
  function handlerProps(props) {
    const out = [];
    if (!props) return out;
    for (const k of Object.keys(props)) if (/^on[A-Z]/.test(k) && typeof props[k] === 'function') out.push(k);
    return out;
  }
  function findReactRoots() {
    const roots = [];
    const seen = new Set();
    const push = (f) => { if (f && !seen.has(f)) { seen.add(f); roots.push(f); } };
    try {
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && hook.getFiberRoots && hook.renderers) {
        for (const [id] of hook.renderers) { try { for (const root of hook.getFiberRoots(id)) push(root.current); } catch { /* ignore */ } }
      }
    } catch { /* ignore */ }
    if (roots.length) return roots;
    const candidates = [document, ...document.querySelectorAll('*')];
    for (const el of candidates) {
      let keys;
      try { keys = Object.keys(el); } catch { continue; }
      for (const k of keys) {
        if (k.startsWith('__reactContainer$')) { const f = el[k]; if (f) push(f.tag === 3 ? f : (f.stateNode && f.stateNode.current) || f); }
        else if (k === '_reactRootContainer') { const f = el[k] && el[k]._internalRoot && el[k]._internalRoot.current; if (f) push(f); }
      }
      if (roots.length >= 10) break;
    }
    if (roots.length) return roots;
    // Fallback: climb from any fiber-bearing element to the HostRoot
    for (const el of candidates) {
      let keys;
      try { keys = Object.keys(el); } catch { continue; }
      const fk = keys.find((k) => k.startsWith('__reactFiber$'));
      if (!fk) continue;
      let f = el[fk];
      let guard = 0;
      while (f && f.return && guard++ < 10000) f = f.return;
      if (f && f.tag === 3) { push(f); break; }
    }
    return roots;
  }
  function detectReact() {
    let version;
    try { const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__; if (hook && hook.renderers) for (const [, r] of hook.renderers) if (r.version) version = r.version; } catch { /* ignore */ }
    const roots = safe(() => findReactRoots(), []);
    if (!roots.length && !version) return undefined;
    return { detected: true, version: version || 'unknown (production build — no devtools hook)', roots: roots.length, mode: roots.length ? (roots[0].mode & 1 ? 'concurrent' : 'legacy') : undefined };
  }
  function buildReactTree({ maxDepth = 400, maxNodes = 40000 } = {}) {
    const roots = findReactRoots();
    const ownerMap = {};
    const handlers = {};
    const componentCounts = {};
    let nodeCount = 0;
    let truncated = false;
    function visit(fiber, depth) {
      if (!fiber) return null;
      if (nodeCount >= maxNodes) { truncated = true; return null; }
      nodeCount++;
      const kind = fiberKind(fiber);
      const node = { n: fiberName(fiber), k: kind };
      if (fiber.key != null) node.key = String(fiber.key);
      if (kind === 'component') {
        node.props = summarizeProps(fiber.memoizedProps);
        componentCounts[node.n] = (componentCounts[node.n] || 0) + 1;
        if (fiber._debugSource) node.src = `${fiber._debugSource.fileName}:${fiber._debugSource.lineNumber}`;
        if (fiber.memoizedState && fiber.tag === 0) { let s = fiber.memoizedState, hooks = 0; while (s && hooks < 200) { hooks++; s = s.next; } node.hooks = hooks; }
      } else if (kind === 'host') {
        const el = fiber.stateNode;
        const scId = el && el.getAttribute ? el.getAttribute('data-sc-id') : null;
        if (scId != null) {
          node.id = Number(scId);
          const hs = handlerProps(fiber.memoizedProps);
          if (hs.length) { node.events = hs; handlers[scId] = hs; }
          const owners = [];
          let p = fiber.return, guard = 0;
          while (p && owners.length < 6 && guard++ < 500) { if (fiberKind(p) === 'component') owners.push(fiberName(p)); p = p.return; }
          if (owners.length) ownerMap[scId] = owners;
        }
      } else if (kind === 'text') {
        node.t = clamp(String(fiber.memoizedProps ?? ''), 80);
      } else if (kind === 'internal' && (fiber.tag === 10 || fiber.tag === 9)) {
        node.props = summarizeProps(fiber.memoizedProps, 6);
      }
      if (depth < maxDepth) {
        const children = [];
        let c = fiber.child, guard = 0;
        while (c && guard++ < 5000) { const cn = visit(c, depth + 1); if (cn) children.push(cn); c = c.sibling; }
        if (children.length) node.c = children;
      } else { node.truncated = true; truncated = true; }
      return node;
    }
    const trees = roots.map((r) => visit(r, 0)).filter(Boolean);
    const counts = Object.entries(componentCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    return { roots: trees, ownerMap, handlers, components: counts, nodeCount, truncated, version: safe(() => detectReact() && detectReact().version) };
  }

  // ---------------------------------------------------------------- Next.js flight data
  function nextFlight({ maxChars = 3_000_000 } = {}) {
    const f = window.__next_f;
    if (!Array.isArray(f)) return { present: false };
    let text = '';
    let chunks = 0;
    for (const entry of f) {
      if (!Array.isArray(entry)) continue;
      chunks++;
      if (entry[0] === 1 && typeof entry[1] === 'string') { if (text.length < maxChars) text += entry[1]; }
    }
    return { present: true, chunks, size: text.length, text: clamp(text, maxChars), nextData: safe(() => (window.__NEXT_DATA__ ? JSON.stringify(window.__NEXT_DATA__).slice(0, maxChars) : undefined)) };
  }

  // ---------------------------------------------------------------- request handling
  async function handle(cmd, args) {
    switch (cmd) {
      case 'ping': return { hook: H.version, installedAt: H.installedAt, net: H.net.length };
      case 'detect': return detect();
      case 'react-tree': return buildReactTree(args);
      case 'network': return { since: H.installedAt, requests: H.net.slice(), sockets: H.sockets.slice(), beacons: H.beacons.slice() };
      case 'console': return { errors: H.errors.slice() };
      case 'next-flight': return nextFlight(args);
      case 'clear': H.net.length = 0; H.sockets.length = 0; H.beacons.length = 0; H.errors.length = 0; return { ok: true };
      default: throw new Error(`unknown hook command: ${cmd}`);
    }
  }
  document.addEventListener('sc:req', async (e) => {
    let req;
    try { req = JSON.parse(e.detail); } catch { return; }
    let out;
    try { out = { id: req.id, ok: true, data: await handle(req.cmd, req.args || {}) }; }
    catch (err) { out = { id: req.id, ok: false, error: String((err && err.stack) || err) }; }
    let payload;
    try { payload = JSON.stringify(out); } catch (err) { payload = JSON.stringify({ id: req.id, ok: false, error: `serialize: ${err}` }); }
    document.dispatchEvent(new CustomEvent('sc:res', { detail: payload }));
  });
})();
