(async () => {
  const titleEl = document.getElementById('tabTitle');
  const urlEl = document.getElementById('tabUrl');
  const btn = document.getElementById('openBtn');
  const err = document.getElementById('err');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && tab.url ? tab.url : '';
  const supported = /^https?:/i.test(url);

  titleEl.textContent = (tab && tab.title) || '(제목 없음)';
  urlEl.textContent = url || '(URL 없음)';
  if (!supported) {
    btn.disabled = true;
    err.style.display = 'block';
    err.textContent = 'http/https 페이지에서만 사용할 수 있습니다. 분석할 사이트 탭에서 다시 열어주세요.';
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'open-dashboard',
        tabId: tab.id,
        windowId: tab.windowId,
        screen: { availWidth: screen.availWidth, availHeight: screen.availHeight },
      });
      if (!res || !res.ok) throw new Error((res && res.error) || 'unknown error');
      window.close();
    } catch (e) {
      btn.disabled = false;
      err.style.display = 'block';
      err.textContent = '대시보드를 열지 못했습니다: ' + e.message;
    }
  });
})();
