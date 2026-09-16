# ANN

`mademate.vercel.app` 분석·복제 프로젝트.

## 구성

| 경로 | 설명 |
| --- | --- |
| `extension/` | **Site Clone Collector** — 대상 페이지의 DOM·계산 스타일·에셋·폰트·스크린샷·네트워크·React 컴포넌트 트리를 수집해 ZIP으로 저장하는 Chrome 확장 프로그램. 설치·사용법은 [`extension/README.md`](extension/README.md) 참고. |

## 진행 순서

1. `extension/` 을 Chrome 개발자 모드로 로드한다.
2. `https://mademate.vercel.app` 을 열고 대시보드에서 **사이트 크롤 시작** → ZIP 다운로드.
3. ZIP의 `pages/<slug>/report.md` 와 `styles/tokens.json`, `framework/react-tree.txt`, `screenshots/` 를 기준으로 복제 구현을 시작한다.
