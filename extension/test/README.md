# 확장 프로그램 E2E 테스트

Playwright로 헤드리스 Chromium에 확장을 로드하고, `site/`의 Next.js 유사 목업 페이지(React 18 UMD, `__NEXT_DATA__`, fixed/sticky, 지연 이미지, 폼, fetch/XHR, 빌드 매니페스트)를 캡처·크롤합니다.

```bash
cd extension/test
npm install                 # playwright, react, react-dom (Chromium은 npx playwright install chromium)
npm run serve &             # 127.0.0.1:8123 에 목업 사이트 서빙
npm test                    # 단일 페이지 캡처 → out/summary-capture.json, out/*.zip, out/*.png
npm run test:crawl          # 4페이지 크롤
```

- 결과 요약: `out/summary-<mode>.json` (요소 수, 시트, 토큰, React 트리, 네트워크, 에셋, 스크린샷 크기…)
- ZIP 무결성은 `python3 -c "import zipfile,glob;print(zipfile.ZipFile(glob.glob('out/*.zip')[0]).testzip())"` 로 확인
- 다른 사이트를 대상으로 하려면 `SITE_URL=https://example.com node run.js capture`
