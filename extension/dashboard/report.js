/* Report builders: page report (markdown), DOM outline, React tree text, root README. */
(function (global) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };
  const fmtBytes = (n) => { if (n == null || isNaN(n)) return '-'; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(2)} MB`; };
  const rectStr = (r) => (r ? `${Math.round(r.w)}×${Math.round(r.h)} @ (${Math.round(r.x)}, ${Math.round(r.y)})` : '-');

  function mdTable(headers, rows) {
    if (!rows.length) return '_(없음)_\n';
    const out = [`| ${headers.map(esc).join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
    for (const r of rows) out.push(`| ${r.map((c) => esc(trunc(c, 200))).join(' | ')} |`);
    return out.join('\n') + '\n';
  }
  function list(items, fmt) { return items.length ? items.map((i) => `- ${fmt ? fmt(i) : i}`).join('\n') + '\n' : '_(없음)_\n'; }

  function stackSummary(data, cap) {
    const h = data.frameworkHints || {};
    const d = (data.hook && data.hook.detect) || {};
    const bundle = (cap && cap.bundle) || {};
    const parts = [];
    if (d.next || (h.next && h.next.detected)) {
      const v = d.next && d.next.version ? ` ${d.next.version}` : '';
      const router = (d.next && d.next.router) || (h.next && h.next.routerGuess);
      parts.push(`Next.js${v}${router ? ` (${router === 'app' ? 'App Router' : 'Pages Router'})` : ''}`);
    }
    if (d.react) {
      const ver = bundle['react-dom'] && bundle['react-dom'].version ? bundle['react-dom'].version : (d.react.version && !/unknown/.test(d.react.version) ? d.react.version : '');
      parts.push(`React${ver ? ' ' + ver : ' (버전 미확인)'}`);
    }
    if (d.vue) parts.push('Vue'); if (d.nuxt) parts.push('Nuxt'); if (d.angular) parts.push(`Angular ${d.angular.version}`); if (d.svelte) parts.push('Svelte'); if (d.remix) parts.push('Remix'); if (d.gatsby) parts.push('Gatsby'); if (d.astro) parts.push('Astro');
    if (h.wordpress) parts.push('WordPress');
    if (h.generator) parts.push(`generator: ${h.generator}`);
    const css = h.css || {};
    const cssParts = [];
    if (css.tailwind) cssParts.push(css.tailwindV4 ? 'Tailwind CSS (v4 추정)' : 'Tailwind CSS');
    if (css.shadcn) cssParts.push('shadcn/ui'); if (css.radix) cssParts.push('Radix UI'); if (css.emotion) cssParts.push('Emotion'); if (css.styledComponents) cssParts.push('styled-components'); if (css.cssModules) cssParts.push('CSS Modules'); if (css.mui) cssParts.push('MUI'); if (css.chakra) cssParts.push('Chakra UI'); if (css.antd) cssParts.push('Ant Design'); if (css.bootstrap) cssParts.push('Bootstrap'); if (css.swiper) cssParts.push('Swiper'); if (css.framerMotionHint) cssParts.push('Framer Motion(추정)'); if (css.lucideIcons) cssParts.push('lucide 아이콘'); if (css.heroicons) cssParts.push('Heroicons'); if (css.fontAwesome) cssParts.push('Font Awesome');
    if (d.gsap) cssParts.push(`GSAP ${d.gsap.version || ''}`.trim()); if (d.three) cssParts.push(`three.js r${d.three.revision}`); if (d.lenis) cssParts.push('Lenis'); if (d.jquery) cssParts.push(`jQuery ${d.jquery.version}`);
    const bundleList = Object.entries(bundle).filter(([n]) => n !== 'react-dom' && n !== 'next.js').map(([n, v]) => `${n}${v.version ? ' ' + v.version : ''}`);
    return { framework: parts, ui: cssParts, analytics: d.analytics || {}, googleFonts: css.googleFonts || [], bundle: bundleList, bundleRaw: bundle };
  }

  function buildPageReport(cap) {
    const d = cap.data;
    const m = d.meta || {};
    const s = stackSummary(d, cap);
    const t = d.tokens || {};
    const st = d.styles || {};
    const L = [];
    L.push(`# 페이지 분석 리포트: ${m.title || cap.url}`);
    L.push('');
    L.push(`- URL: ${cap.url}`);
    L.push(`- 캡처 시각: ${m.capturedAt}`);
    L.push(`- 언어/문자셋: ${m.lang || '-'} / ${m.charset}`);
    L.push(`- 뷰포트: ${m.viewport ? `${m.viewport.innerWidth}×${m.viewport.innerHeight} (DPR ${m.viewport.devicePixelRatio})` : '-'}`);
    L.push(`- 문서 크기: ${m.document ? `${m.document.scrollWidth}×${m.document.scrollHeight}` : '-'} px`);
    L.push(`- 요소 수: ${m.elementCount} (스타일 수집 ${d.elementStats ? d.elementStats.styled : 0}${d.elementStats && d.elementStats.truncatedStyles ? ', 상한 도달로 일부 생략' : ''})`);
    L.push(`- 수집 소요: ${d.timings ? d.timings.total : '-'} ms`);
    L.push('');

    L.push('## 1. 기술 스택');
    L.push(`- 프레임워크: ${s.framework.length ? s.framework.join(', ') : '감지되지 않음'}`);
    L.push(`- UI/CSS/라이브러리: ${s.ui.length ? s.ui.join(', ') : '특이사항 없음'}`);
    if (s.bundle.length) L.push(`- 번들 시그니처(다운로드한 JS/CSS 내용 기반, framework/bundle-signatures.json): ${s.bundle.join(', ')}`);
    if (Object.keys(s.analytics).length) L.push(`- 분석/서드파티: ${Object.entries(s.analytics).map(([k, v]) => (v === true ? k : `${k}(${Array.isArray(v) ? v.join(',') : v})`)).join(', ')}`);
    const hn = d.frameworkHints && d.frameworkHints.next;
    const dn = d.hook && d.hook.detect && d.hook.detect.next;
    if (hn || dn) {
      L.push(`- Next.js buildId: ${(hn && hn.buildId) || (dn && dn.buildId) || '-'}`);
      if (hn && hn.nextData) L.push(`- __NEXT_DATA__: page=${hn.nextData.page}, locale=${hn.nextData.locale || '-'}, gsp=${!!hn.nextData.gsp}, gssp=${!!hn.nextData.gssp}`);
      if (dn && dn.hasFlightData) L.push(`- RSC flight 데이터: ${dn.flightChunks} chunks (framework/rsc-flight.txt 참고)`);
      if (hn && hn.nextFontPreloads && hn.nextFontPreloads.length) L.push(`- next/font 프리로드: ${hn.nextFontPreloads.length}개`);
      if (hn && hn.imageOptimizerUsed) L.push('- next/image 최적화 이미지 사용 (원본 URL은 assets/manifest.json의 originalSrc 참고)');
      if (cap.next && cap.next.sortedPages && cap.next.sortedPages.length) L.push(`- 빌드 매니페스트 라우트(${cap.next.sortedPages.length}): ${cap.next.sortedPages.slice(0, 60).join(', ')}${cap.next.sortedPages.length > 60 ? ' …' : ''}`);
      if (cap.next && cap.next.ssgPages && cap.next.ssgPages.length) L.push(`- SSG 라우트(${cap.next.ssgPages.length}): ${cap.next.ssgPages.slice(0, 60).join(', ')}`);
    }
    if (d.hook && d.hook.detect && d.hook.detect.globals && d.hook.detect.globals.length) L.push(`- 커스텀 window 전역(${d.hook.detect.globals.length}): ${d.hook.detect.globals.slice(0, 40).map((g) => g.name).join(', ')}`);
    L.push('');

    L.push('## 2. 메타 / SEO');
    const metaRows = (d.head && d.head.metaTags || []).filter((x) => x.name || x.property || x['http-equiv'] || x.charset).map((x) => [x.name || x.property || x['http-equiv'] || (x.charset ? 'charset' : ''), x.content || x.charset || '']);
    L.push(mdTable(['name/property', 'content'], metaRows.slice(0, 80)));
    const iconRows = (d.assets && d.assets.favicons || []).map((f) => [f.rel, f.sizes || '', f.href]);
    L.push('파비콘/매니페스트:');
    L.push(mdTable(['rel', 'sizes', 'href'], iconRows));
    L.push('');

    L.push('## 3. 레이아웃 구조');
    const lm = (d.structure && d.structure.landmarks) || [];
    L.push(mdTable(['태그', 'role/label', '크기/위치', '선택자'], lm.slice(0, 60).map((x) => [x.tag, [x.role, x.label].filter(Boolean).join(' / '), rectStr(x.rect), x.path])));
    L.push('');
    L.push('헤딩 아웃라인:');
    const hs = (d.structure && d.structure.headings) || [];
    L.push(hs.length ? hs.slice(0, 120).map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- h${h.level}: ${trunc(h.text, 100)}`).join('\n') + '\n' : '_(없음)_\n');
    L.push('');
    L.push(`- 브레이크포인트(px): ${(st.breakpoints || []).join(', ') || '-'}`);
    L.push(`- 컨테이너 max-width 상위: ${(t.maxWidths || []).slice(0, 8).map((x) => `${x.value}(${x.count})`).join(', ') || '-'}`);
    L.push(`- 미디어쿼리 ${(st.mediaQueries || []).length}종, 컨테이너 쿼리 ${(st.containerQueries || []).length}종, @layer: ${(st.layers || []).join(', ') || '-'}`);
    L.push('');
    L.push('섹션(스크린샷 크롭 단위):');
    L.push(mdTable(['이름', '태그', '라벨', '크기/위치'], ((d.structure && d.structure.sections) || []).map((x) => [x.name, x.tag, x.label || '', rectStr(x.rect)])));
    L.push('');

    L.push('## 4. 디자인 토큰 (계산 스타일 빈도 기반)');
    L.push('색상 (사용 횟수, 용도):');
    L.push(mdTable(['색상', '횟수', '용도'], (t.colors || []).slice(0, 40).map((c) => [c.value, c.count, (c.uses || []).join(' ')])));
    L.push('폰트 패밀리:');
    L.push(mdTable(['family', '횟수'], (t.fontFamilies || []).map((c) => [c.value, c.count])));
    L.push('폰트 스택(font-family 전체값):');
    L.push(mdTable(['stack', '횟수'], (t.fontStacks || []).slice(0, 10).map((c) => [c.value, c.count])));
    L.push(`- 폰트 크기 스케일: ${(t.fontSizes || []).map((x) => `${x.value}(${x.count})`).join(', ') || '-'}`);
    L.push(`- 굵기: ${(t.fontWeights || []).map((x) => `${x.value}(${x.count})`).join(', ') || '-'}`);
    L.push(`- 행간: ${(t.lineHeights || []).slice(0, 12).map((x) => `${x.value}(${x.count})`).join(', ') || '-'}`);
    L.push(`- 자간: ${(t.letterSpacings || []).slice(0, 8).map((x) => `${x.value}(${x.count})`).join(', ') || '-'}`);
    L.push(`- radius: ${(t.radii || []).map((x) => `${x.value}(${x.count})`).join(', ') || '-'}`);
    L.push(`- gap: ${(t.gaps || []).map((x) => `${x.value}(${x.count})`).join(', ') || '-'}`);
    L.push(`- padding 값: ${(t.paddings || []).slice(0, 16).map((x) => `${x.value}(${x.count})`).join(', ') || '-'}`);
    L.push(`- margin 값: ${(t.margins || []).slice(0, 16).map((x) => `${x.value}(${x.count})`).join(', ') || '-'}`);
    L.push(`- z-index: ${(t.zIndexes || []).map((x) => `${x.value}(${x.count})`).join(', ') || '-'}`);
    L.push('그림자:');
    L.push(list((t.shadows || []).slice(0, 10), (x) => `\`${x.value}\` (${x.count})`));
    L.push('그라디언트:');
    L.push(list((t.gradients || []).slice(0, 10), (x) => `\`${trunc(x.value, 200)}\` (${x.count})`));
    L.push('테두리:');
    L.push(list((t.borders || []).slice(0, 10), (x) => `\`${x.value}\` (${x.count})`));
    L.push('트랜지션:');
    L.push(list((t.transitions || []).slice(0, 10), (x) => `\`${x.value}\` (${x.count})`));
    const rootVars = Object.entries(st.rootVars || {});
    L.push(`CSS 변수 (:root 계산값, ${rootVars.length}개 중 상위 120):`);
    L.push(mdTable(['변수', '값'], rootVars.slice(0, 120).map(([k, v]) => [k, trunc(v, 120)])));
    L.push('');

    L.push('## 5. 폰트');
    const ff = st.fontFaces || [];
    L.push(mdTable(['family', 'weight', 'style', 'display', 'src'], ff.slice(0, 60).map((f) => [f.family, f.weight || '', f.style || '', f.display || '', (f.srcUrls || []).slice(0, 2).join(' ')])));
    if (s.googleFonts.length) L.push(list(s.googleFonts, (u) => `Google Fonts: ${u}`));
    L.push(`- document.fonts 상태: ${d.fonts ? d.fonts.status : '-'}, 로드된 페이스 ${d.fonts ? d.fonts.loaded.length : 0}개`);
    L.push('');

    L.push('## 6. React 컴포넌트');
    const rt = d.hook && d.hook.react;
    if (rt && rt.roots && rt.roots.length) {
      L.push(`- 파이버 노드 ${rt.nodeCount}개${rt.truncated ? ' (상한 도달, 일부 생략)' : ''}, 루트 ${rt.roots.length}개`);
      L.push('- 컴포넌트 사용 빈도 상위:');
      L.push(mdTable(['컴포넌트', '횟수'], (rt.components || []).slice(0, 40).map((c) => [c.name, c.count])));
      L.push('- 상위 트리 (depth ≤ 6, host 요소 생략) — 전체는 framework/react-tree.txt:');
      L.push('```');
      L.push(reactTreeText(rt.roots, { maxDepth: 6, hideHost: true, maxLines: 120 }));
      L.push('```');
    } else L.push(`_(React 트리 없음${d.hook && d.hook.reactError ? `: ${d.hook.reactError}` : ''})_`);
    L.push('');

    L.push('## 7. 에셋');
    const a = d.assets || {};
    L.push(`- 이미지 ${(a.images || []).length}, 배경이미지 ${(a.backgroundImages || []).length}, 인라인 SVG ${(a.svgs || []).length}, 비디오 ${(a.videos || []).length}, 오디오 ${(a.audios || []).length}, iframe ${(a.iframes || []).length}, canvas ${(a.canvases || []).length}`);
    L.push(mdTable(['이미지', 'alt', '표시 크기', '원본 크기', '위치'], (a.images || []).slice(0, 80).map((i) => [trunc(i.currentSrc || i.src, 120), i.alt || '', `${Math.round(i.rect.w)}×${Math.round(i.rect.h)}`, `${i.naturalWidth}×${i.naturalHeight}`, `(${Math.round(i.rect.x)}, ${Math.round(i.rect.y)})`])));
    if ((a.backgroundImages || []).length) L.push(mdTable(['배경 이미지/그라디언트', '선택자', '크기'], a.backgroundImages.slice(0, 40).map((b) => [b.urls && b.urls.length ? b.urls.join(' ') : trunc(b.gradient || '', 120), b.path, rectStr(b.rect)])));
    if ((a.iframes || []).length) L.push(mdTable(['iframe', 'title', '크기'], a.iframes.map((f) => [f.src, f.title || '', rectStr(f.rect)])));
    if ((a.videos || []).length) L.push(mdTable(['video', 'poster', 'autoplay/loop/muted', '크기'], a.videos.map((v) => [v.currentSrc || v.src || (v.sources[0] && v.sources[0].src) || '', v.poster || '', `${v.autoplay}/${v.loop}/${v.muted}`, rectStr(v.rect)])));
    if (cap.assetRefs && cap.assetRefs.length) {
      const ok = cap.assetRefs.filter((r) => r.status === 'ok');
      const fail = cap.assetRefs.filter((r) => r.status !== 'ok' && r.status !== 'skipped');
      L.push(`- 다운로드: 성공 ${ok.length} / 실패 ${fail.length} / 총 ${fmtBytes(ok.reduce((n, r) => n + (r.size || 0), 0))} (assets/manifest.json 참고)`);
      if (fail.length) L.push(list(fail.slice(0, 20), (r) => `실패: ${r.url} — ${r.error || r.status}`));
    }
    L.push('');

    L.push('## 8. 인터랙션 / 애니메이션');
    const inter = d.interactive || [];
    L.push(`인터랙티브 요소 ${inter.length}개 (상위 80):`);
    L.push(mdTable(['텍스트', '태그', 'role/type', 'href', 'React 핸들러', '컴포넌트', '위치'], inter.slice(0, 80).map((i) => { const el = (d.elements || []).find((e) => e.id === i.id); return [i.text || i.ariaLabel || '', i.tag, [i.role, i.type].filter(Boolean).join('/'), i.href ? trunc(i.href, 80) : '', (i.reactHandlers || []).join(','), el && el.component ? el.component[0] : '', rectStr(i.rect)]; })));
    const sr = st.stateRules || [];
    L.push(`- 상태 규칙(:hover/:focus/:active 등) ${sr.length}개 — styles/state-rules.json`);
    L.push(list(sr.slice(0, 12), (r) => `\`${trunc(r.selector, 80)}\` → \`${trunc(r.css, 120)}\``));
    const an = d.animations || {};
    L.push(`- CSS 애니메이션 요소 ${(an.css || []).length}, 트랜지션 요소 ${(an.transitions || []).length}, keyframes: ${(an.keyframes || []).join(', ') || '-'}`);
    L.push(list((an.css || []).slice(0, 12), (x) => `\`${trunc(x.path, 80)}\`: ${x.name} ${x.duration} ${x.timing} ${x.iteration}`));
    L.push(`- Web Animations API 활성 ${(an.webAnimations || []).length}개`);
    L.push('');

    L.push('## 9. 폼');
    const forms = (d.forms && d.forms.forms) || [];
    for (const f of forms) {
      L.push(`- form ${f.method.toUpperCase()} ${f.action || '(action 없음)'} \`${f.path}\``);
      L.push(mdTable(['필드', 'type', 'name', 'placeholder', 'label', '필수'], f.fields.map((x) => [x.tag, x.type, x.name || '', x.placeholder || '', x.label || '', x.required ? 'Y' : ''])));
    }
    const orphan = (d.forms && d.forms.orphanFields) || [];
    if (orphan.length) { L.push('form 밖 입력 필드:'); L.push(mdTable(['필드', 'type', 'name', 'placeholder', 'label'], orphan.slice(0, 40).map((x) => [x.tag, x.type, x.name || '', x.placeholder || '', x.label || '']))); }
    if (!forms.length && !orphan.length) L.push('_(없음)_');
    L.push('');

    L.push('## 10. 네트워크 / API');
    const net = (d.hook && d.hook.network && d.hook.network.requests) || [];
    if (net.length) {
      const uniq = new Map();
      for (const r of net) { try { const u = new URL(r.url); const key = `${r.method} ${u.origin}${u.pathname}`; const e = uniq.get(key) || { key, count: 0, status: r.status, ct: (r.resHeaders && r.resHeaders['content-type']) || '', sample: r.url }; e.count++; uniq.set(key, e); } catch { /* ignore */ } }
      L.push(`기록된 fetch/XHR ${net.length}건 (훅 설치 이후), 고유 엔드포인트 ${uniq.size}개 — 본문은 network.json:`);
      L.push(mdTable(['method + endpoint', '횟수', 'status', 'content-type'], Array.from(uniq.values()).slice(0, 60).map((e) => [e.key, e.count, e.status || '', trunc(e.ct, 40)])));
    } else L.push(`_(fetch/XHR 기록 없음${d.hook && !d.hook.present ? ' — 훅 미설치' : ''})_`);
    const sockets = (d.hook && d.hook.network && d.hook.network.sockets) || [];
    if (sockets.length) L.push(list(sockets.slice(0, 20), (x) => `${x.kind}: ${x.url}`));
    const perf = (d.performance && d.performance.resources) || [];
    const byType = {};
    for (const r of perf) { const k = r.initiatorType || 'other'; byType[k] = byType[k] || { count: 0, bytes: 0 }; byType[k].count++; byType[k].bytes += r.transferSize || 0; }
    L.push(`리소스 타이밍 ${perf.length}건 (performance.json):`);
    L.push(mdTable(['initiator', '개수', '전송량'], Object.entries(byType).map(([k, v]) => [k, v.count, fmtBytes(v.bytes)])));
    const thirdParty = new Set();
    for (const r of perf) { try { const h = new URL(r.name).host; if (h !== new URL(cap.url).host) thirdParty.add(h); } catch { /* ignore */ } }
    L.push(`- 서드파티 호스트: ${Array.from(thirdParty).slice(0, 40).join(', ') || '-'}`);
    const errs = (d.hook && d.hook.console && d.hook.console.errors) || [];
    if (errs.length) L.push(`- 콘솔 오류 ${errs.length}건 (framework/console-errors.json)`);
    L.push('');

    L.push('## 11. 링크 / 라우트');
    const links = (d.links && d.links.list) || [];
    L.push(`- 링크 ${links.length}개: ${Object.entries((d.links && d.links.counts) || {}).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    L.push(`- 내부 URL(고유 ${(d.links && d.links.internalUrls || []).length}):`);
    L.push(list((d.links && d.links.internalUrls || []).slice(0, 150)));
    const ext = Array.from(new Set(links.filter((l) => l.kind === 'external').map((l) => { try { return new URL(l.href).host; } catch { return l.href; } })));
    L.push(`- 외부 호스트: ${ext.slice(0, 40).join(', ') || '-'}`);
    L.push('');

    L.push('## 12. 스토리지 / 쿠키');
    const sto = d.storage || {};
    L.push(`- localStorage 키: ${(sto.localStorage || []).map((x) => `${x.key}(${x.size})`).join(', ') || '-'}`);
    L.push(`- sessionStorage 키: ${(sto.sessionStorage || []).map((x) => `${x.key}(${x.size})`).join(', ') || '-'}`);
    L.push(`- 쿠키(JS 접근 가능) 키: ${(sto.cookies || []).map((x) => x.key).join(', ') || '-'}`);
    L.push('');

    L.push('## 13. 스크립트');
    const scripts = d.scripts || [];
    L.push(`- 외부 스크립트 ${scripts.filter((x) => x.src).length}개, 인라인 ${scripts.filter((x) => !x.src).length}개 (scripts.json)`);
    L.push(list(scripts.filter((x) => x.src).slice(0, 40), (x) => `${x.src}${x.module ? ' [module]' : ''}${x.async ? ' [async]' : ''}${x.defer ? ' [defer]' : ''}`));
    L.push('');

    L.push('## 14. 이 폴더의 파일');
    L.push([
      '- `report.md` — 이 문서',
      '- `page.html` — 렌더된 DOM 스냅샷 (각 요소에 `data-sc-id` 부여; page.json/elements 와 대응)',
      '- `dom-outline.txt` — 보이는 요소의 들여쓰기 트리 (태그·클래스·크기·컴포넌트)',
      '- `page.json` — 메타·헤드·구조·링크·폼·인터랙션·애니메이션·토큰·스토리지·성능 등',
      '- `elements.json` — 요소별 비기본 계산 스타일 + 좌표 + React 컴포넌트/핸들러 매핑',
      '- `styles/` — 시트별 CSS 텍스트, `stylesheets.json`, `fontfaces.json`, `keyframes.css`, `state-rules.json`, `tokens.json`, `custom-properties.json`',
      '- `assets.json`, `scripts.json`, `network.json`, `performance.json`',
      '- `framework/` — `detect.json`, `react-tree.json`, `react-tree.txt`, `next-data.json`, `rsc-flight.txt`, `console-errors.json`',
      '- `screenshots/` — `full-<너비>.png`, `sections/`, 반응형 `full-<너비>.png`',
      '- `svg/` — 인라인 SVG 파일 (중복 제거)',
    ].join('\n'));
    L.push('');
    return L.join('\n');
  }

  function reactTreeText(roots, { maxDepth = 400, hideHost = false, maxLines = 30000 } = {}) {
    const lines = [];
    let over = false;
    function walk(n, depth, prefix) {
      if (lines.length >= maxLines) { over = true; return; }
      if (depth > maxDepth) return;
      const isHost = n.k === 'host' || n.k === 'text';
      if (!(hideHost && isHost)) {
        let label;
        if (n.k === 'host') label = `<${n.n}${n.id != null ? ` #${n.id}` : ''}${n.events ? ` on:${n.events.join(',')}` : ''}>`;
        else if (n.k === 'text') label = `"${n.t}"`;
        else {
          const props = n.props ? Object.entries(n.props).filter(([k]) => k !== 'children').slice(0, 8).map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)}`).join(' ') : '';
          label = `${n.n}${n.key ? ` key=${n.key}` : ''}${props ? ` {${trunc(props, 160)}}` : ''}${n.hooks ? ` hooks:${n.hooks}` : ''}${n.src ? ` @${n.src}` : ''}`;
        }
        lines.push(`${prefix}${label}${n.truncated ? ' …(truncated)' : ''}`);
      }
      const childPrefix = hideHost && isHost ? prefix : prefix + '  ';
      for (const c of n.c || []) walk(c, depth + 1, childPrefix);
    }
    for (const r of roots || []) walk(r, 0, '');
    if (over) lines.push(`… (${maxLines}줄 초과, 생략)`);
    return lines.join('\n');
  }

  function domOutline(data, { maxLines = 6000 } = {}) {
    const els = data.elements || [];
    const lines = [];
    for (const e of els) {
      if (!e.visible) continue;
      if (lines.length >= maxLines) { lines.push('… (생략)'); break; }
      const cls = e.classes ? e.classes.slice(0, 4).map((c) => `.${c}`).join('') + (e.classes.length > 4 ? `(+${e.classes.length - 4})` : '') : '';
      const comp = e.component ? ` <${e.component[0]}>` : '';
      const ev = e.events ? ` on:${e.events.join(',')}` : '';
      const txt = e.text ? ` "${trunc(e.text, 50)}"` : '';
      lines.push(`${'  '.repeat(Math.min(e.depth, 40))}${e.tag}${e.idAttr ? `#${e.idAttr}` : ''}${cls} [${Math.round(e.rect.w)}×${Math.round(e.rect.h)} @${Math.round(e.rect.x)},${Math.round(e.rect.y)}] #${e.id}${comp}${ev}${txt}`);
    }
    return lines.join('\n');
  }

  function rootReadme(state) {
    const caps = state.captures;
    const L = [];
    L.push(`# 사이트 수집 결과: ${state.siteHost || ''}`);
    L.push('');
    L.push(`- 생성: ${new Date().toISOString()}`);
    L.push(`- 수집기: Site Clone Collector ${state.version}`);
    L.push(`- 페이지 수: ${caps.length}`);
    L.push(`- 에셋 파일: ${state.assetCount || 0} (${fmtBytes(state.assetBytes || 0)})`);
    L.push('');
    L.push('## 페이지 목록');
    L.push(mdTable(['폴더', 'URL', '제목', '요소', '스크린샷'], caps.map((c) => [`pages/${c.slug}/`, c.url, c.data.meta.title || '', c.data.meta.elementCount, c.screenshots && c.screenshots.full ? `${c.screenshots.full.cssWidth}×${c.screenshots.full.cssHeight}` : '-'])));
    L.push('');
    if (state.sitemap) {
      L.push('## 사이트맵 (발견된 내부 URL)');
      L.push(`- 캡처 ${state.sitemap.captured.length} / 대기·건너뜀 ${state.sitemap.pending.length + state.sitemap.skipped.length} — sitemap.json`);
      L.push(list(state.sitemap.captured.slice(0, 200)));
      if (state.sitemap.pending.length) { L.push('미수집 (한도 초과 등):'); L.push(list(state.sitemap.pending.slice(0, 200))); }
      L.push('');
    }
    L.push('## 복제 작업 권장 순서');
    L.push([
      '1. `pages/<index>/report.md` 로 기술 스택·레이아웃·토큰을 파악한다.',
      '2. `styles/tokens.json` + `custom-properties.json` 으로 디자인 토큰(색·폰트·radius·spacing)을 정의한다.',
      '3. `styles/fontfaces.json` 과 `assets/` 의 폰트 파일로 @font-face 를 재구성한다.',
      '4. `framework/react-tree.txt` 로 컴포넌트 계층을, `elements.json`(component 필드)으로 DOM ↔ 컴포넌트 대응을 확인한다.',
      '5. `page.html` + `elements.json`(styles/rect) + `screenshots/` 를 대조하며 섹션 단위로 마크업/스타일을 구현한다.',
      '6. `network.json` 의 API 엔드포인트/응답 스키마로 데이터 계층(모의 API)을 만든다.',
      '7. `state-rules.json`, `animations`(page.json) 로 hover/focus/애니메이션을 재현한다.',
      '8. 반응형 스크린샷(`full-375.png` 등)과 `breakpoints` 로 반응형 규칙을 맞춘다.',
    ].join('\n'));
    L.push('');
    L.push('## 폴더 구조');
    L.push([
      '```',
      'README.md',
      'sitemap.json',
      'pages/<slug>/  report.md, page.html, dom-outline.txt, page.json, elements.json,',
      '               styles/, framework/, screenshots/, svg/, assets.json, scripts.json, network.json, performance.json',
      'assets/        manifest.json + <host>/<경로> 원본 파일',
      '```',
    ].join('\n'));
    return L.join('\n');
  }

  global.SCReport = { buildPageReport, reactTreeText, domOutline, rootReadme, stackSummary, fmtBytes };
})(typeof self !== 'undefined' ? self : globalThis);
