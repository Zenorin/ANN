# Site Clone Collector (Chrome 확장 프로그램)

웹페이지를 **최대한 그대로 복제**하기 위해 필요한 정보를 한 번에 수집해 ZIP으로 내려주는 분석 도구입니다.
기본 대상은 `https://mademate.vercel.app` 이지만 어떤 http/https 사이트에서도 동작합니다.

## 무엇을 수집하나

| 영역 | 수집 내용 | 출력 파일 |
| --- | --- | --- |
| DOM | 렌더된 최종 HTML(열린 Shadow DOM 포함), 요소별 `data-sc-id` 부여 | `page.html`, `dom-outline.txt` |
| 스타일 | 요소별 **비기본 계산 스타일**(UA 기본값·상속값 제외), `::before/::after`, 인라인 style, 좌표(rect) | `elements.json` |
| 스타일시트 | 시트별 CSS 텍스트(CSSOM 기준 + 원문), `@font-face`, `@keyframes`, 미디어쿼리/브레이크포인트, CSS 변수, `:hover/:focus` 등 상태 규칙 | `styles/*` |
| 디자인 토큰 | 색상(용도별 빈도), 폰트 패밀리/크기/굵기/행간, radius, shadow, gap/padding/margin, max-width, gradient, transition | `styles/tokens.json` |
| 에셋 | 이미지(next/image 원본 포함), 배경이미지, 폰트 파일, CSS, JS 번들, 파비콘/manifest, (옵션) 비디오·srcset 변형 — 실제 파일 다운로드 | `assets/<host>/…`, `assets/manifest.json` |
| 인라인 SVG / canvas | 아이콘 SVG 파일(중복 제거), canvas 렌더 결과 PNG | `svg/`, `canvas/` |
| 스크린샷 | 전체 페이지(스크롤 스티칭, fixed/sticky 처리), 섹션별 크롭, 반응형(375/768/1024 등 창 너비 변경) | `screenshots/` |
| 구조 | 랜드마크(header/nav/main/section/footer…), 헤딩 아웃라인, 섹션 목록, 폼/필드/라벨, 인터랙티브 요소 | `page.json` |
| 프레임워크 | Next.js(buildId, Pages/App Router, `__NEXT_DATA__`, RSC flight, 빌드 매니페스트 라우트), React **컴포넌트 트리(fiber)** + DOM↔컴포넌트 매핑 + 이벤트 핸들러 이름, 기타 라이브러리/분석도구 감지, 다운로드한 번들의 시그니처 스캔 | `framework/*` |
| 네트워크 | fetch/XHR 요청·응답(본문 포함, 민감 헤더 마스킹), WebSocket/EventSource, sendBeacon, 리소스 타이밍 | `network.json`, `performance.json` |
| 애니메이션 | CSS animation/transition 사용 요소, Web Animations API 상태, keyframes | `page.json`, `styles/keyframes.css` |
| 기타 | 메타/OG/링크 태그, 스크립트 목록(인라인 포함), localStorage/sessionStorage/쿠키 **키**(값은 옵션, 민감 키 마스킹), 콘솔 오류, 내부/외부 링크 | `page.json`, `scripts.json` |
| 사이트 크롤 | 내부 링크 + Next.js 매니페스트 라우트를 따라 여러 페이지 수집 | `pages/<slug>/…`, `sitemap.json` |

각 페이지 폴더에는 사람이 읽을 수 있는 **`report.md`**(한국어 요약 리포트)가 함께 생성됩니다.

## 설치 (개발자 모드)

1. Chrome(또는 Edge/Brave/Whale 등 Chromium 116+)에서 `chrome://extensions` 를 엽니다.
2. 우측 상단 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드** → 이 저장소의 `extension/` 폴더를 선택합니다.
4. 툴바에 아이콘이 나타납니다(퍼즐 아이콘에서 고정 가능).

## 사용 방법

1. 분석할 페이지(예: `https://mademate.vercel.app`)를 탭에서 엽니다. 모달·쿠키 배너는 닫아 둡니다.
2. 툴바 아이콘 → **분석 대시보드 열기**. 대시보드는 별도 창으로 열립니다.
3. 옵션을 확인하고 **이 페이지 캡처** 또는 **사이트 크롤 시작**을 누릅니다.
   - 캡처 중 대상 창을 최소화하거나 완전히 가리지 마세요(스크린샷 API 제약).
   - "페이지 로드 시점부터 기록"이 켜져 있으면 훅을 등록한 뒤 페이지를 한 번 새로고침합니다.
4. 결과 탭(요약 / 디자인 토큰 / 스크린샷 / 에셋 / 네트워크 / React 트리 / 리포트)에서 내용을 확인합니다.
5. **ZIP 다운로드** → `다운로드/site-clone/<host>_<시각>.zip` 에 저장됩니다. (`JSON만 다운로드`는 스크린샷·에셋 없이 데이터만 저장)

## ZIP 구조

```
<host>_<timestamp>/
├── README.md                # 전체 요약, 복제 권장 순서
├── sitemap.json             # 크롤 시 발견/수집/미수집 URL
├── log.txt
├── pages/<slug>/
│   ├── report.md            # 페이지 리포트(기술 스택·레이아웃·토큰·컴포넌트·API…)
│   ├── page.html            # 렌더된 DOM (data-sc-id 포함)
│   ├── dom-outline.txt      # 보이는 요소 트리 (태그·클래스·크기·컴포넌트·핸들러)
│   ├── page.json            # 메타·구조·링크·폼·인터랙션·애니메이션·토큰·스토리지
│   ├── elements.json        # 요소별 계산 스타일 + rect + React 컴포넌트/이벤트
│   ├── assets.json / scripts.json / network.json / performance.json
│   ├── styles/              # sheet-NNN.css, inline-NNN.css, stylesheets.json, fontfaces.json,
│   │                        # keyframes.css, state-rules.json, tokens.json, custom-properties.json, media-queries.json
│   ├── framework/           # detect.json, react-tree.json/.txt, react-components.json, next-data.json,
│   │                        # rsc-flight.txt, build-manifest.json, bundle-signatures.json, console-errors.json
│   ├── screenshots/         # full-<너비>.png, sections/NN-<이름>.png (+ index.json)
│   ├── svg/                 # 인라인 SVG 파일
│   └── canvas/
└── assets/
    ├── manifest.json        # 원본 URL ↔ 저장 경로 ↔ 상태
    └── <host>/<경로>/…      # 다운로드한 원본 파일 (이미지·폰트·CSS·JS…)
```

## 옵션 요약

- **스크린샷**: 전체 페이지 / 섹션 크롭 / 반응형(창 너비 목록) / 포맷(PNG·JPEG) / 최대 높이
- **DOM·스타일**: 계산 스타일 수집 여부, 스타일 수집 최대 요소 수(기본 6000), 수집 전 스크롤(지연 로딩 유도)
- **프레임워크·네트워크**: React 트리, fetch/XHR 기록, 로드 시점부터 기록(새로고침), 스토리지 값 포함
- **에셋**: 종류별 선택(이미지/폰트/CSS/JS/비디오/srcset 전체), 파일당·총 용량 상한
- **크롤**: 최대 페이지, 경로 접두어 필터, 페이지당 추가 대기, Next.js 매니페스트 라우트 사용

## 동작 원리

- `content/collector.js` (격리 월드): DOM/스타일/에셋/구조 수집, 스크린샷 보조(스크롤·fixed/sticky 처리)
- `content/hook.js` (MAIN 월드): fetch/XHR/WebSocket 후킹, 프레임워크 전역 감지, React fiber 트리 순회
- `dashboard/dashboard.js`: 오케스트레이션(스크린샷 스티칭, 창 리사이즈, 에셋 다운로드, 크롤, ZIP 생성)
- `dashboard/zip.js`: 의존성 없는 ZIP 라이브러리(`CompressionStream` deflate)
- `dashboard/report.js`: 리포트/아웃라인/React 트리 텍스트 생성

## 제한 사항

- `:hover` 등 상태의 **계산값**은 얻을 수 없습니다. 대신 상태 규칙(`state-rules.json`)을 원문으로 보관합니다.
- 반응형 캡처는 **창 너비 변경** 방식이라 터치/UA 에뮬레이션은 아닙니다. OS 최소 창 크기 때문에 375px가 정확히 맞지 않을 수 있습니다(실제 너비를 파일명에 기록).
- 스크린샷은 `captureVisibleTab` 제약(초당 2회, 창이 보여야 함)으로 긴 페이지에서 시간이 걸립니다.
- JS로 구동되는 애니메이션(Framer Motion, GSAP 등)은 캡처 시점의 상태만 기록됩니다.
- 프로덕션 React 빌드는 컴포넌트 **이름이 난독화**될 수 있습니다(예: `t`, `n`). 이 경우 트리 구조·props 키·DOM 매핑으로 유추합니다.
- 훅은 확장 프로그램이 주입하므로 페이지 CSP의 영향을 받지 않지만, 일부 페이지(chrome://, 스토어 등)에서는 동작하지 않습니다.
- 수집 데이터에는 로그인 상태의 개인 정보가 포함될 수 있습니다. 공유 전 `network.json`, `storage` 항목을 확인하세요.

## 테스트

`tests/` 없이도 Playwright로 실제 Chromium에 확장을 로드해 검증했습니다(로컬 Next.js 유사 페이지: `__NEXT_DATA__`, React 18 UMD, fixed/sticky 요소, 지연 이미지, 폼, fetch/XHR, 빌드 매니페스트). 검증 항목: 스크린샷 스티칭, 반응형 창 리사이즈·복원, React 트리/핸들러 매핑, 네트워크 기록(로드 시점부터), 에셋 다운로드·CSS `url()` 추적, ZIP 무결성(`zipfile.testzip`), 크롤(4페이지).
