import { SUPER_FEVER_LAUNCH_AT_MS } from './gameConstants.js';

// 공지 종료: 적용 후 7일 (2026-07-29 00:00 KST)
const NOTICE_END_AT_MS = Date.parse('2026-07-28T15:00:00.000Z');
const NOTICE_DISMISSED_KEY = 'sequencepang-super-fever-2026-07-22-dismissed';

export function initSuperFeverNotice() {
  if (Date.now() >= NOTICE_END_AT_MS) return;
  if (localStorage.getItem(NOTICE_DISMISSED_KEY) === 'true') return;

  const isLive = Date.now() >= SUPER_FEVER_LAUNCH_AT_MS;
  const title = isLive ? '슈퍼피버 등장!' : '슈퍼피버 업데이트 예고';
  const datePill = isLive ? '×3 · 빅넘버 · 점수 ×2' : '7월 22일 00:00 적용';

  const overlay = document.createElement('div');
  overlay.className = 'super-fever-notice-overlay';
  overlay.innerHTML = `
    <section class="super-fever-notice" role="dialog" aria-modal="true" aria-labelledby="super-fever-notice-title">
      <span class="super-fever-notice-icon" aria-hidden="true">🌟</span>
      <p class="super-fever-notice-eyebrow">NEW EVENT</p>
      <h2 id="super-fever-notice-title">${title}</h2>
      <p class="super-fever-notice-date">${datePill}</p>
      <p class="super-fever-notice-copy">
        숫자 <strong>5개 이상</strong> 수열을 성공하면<br>
        보라색 <strong>슈퍼피버 블록</strong>이 나타납니다!<br>
        보드가 <strong>×3</strong> 변신 또는 <strong>10~19 빅넘버</strong> 등장, 점수는 <strong>2배</strong>!
      </p>
      <div class="super-fever-notice-actions">
        <button type="button" class="super-fever-notice-close">닫기</button>
        <button type="button" class="super-fever-notice-dismiss">다시 보지 않기</button>
      </div>
    </section>
  `;

  const closeButton = overlay.querySelector('.super-fever-notice-close');
  const dismissButton = overlay.querySelector('.super-fever-notice-dismiss');

  function closeNotice() {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
  }

  function dismissNotice() {
    localStorage.setItem(NOTICE_DISMISSED_KEY, 'true');
    closeNotice();
  }

  closeButton.addEventListener('click', closeNotice);
  dismissButton.addEventListener('click', dismissNotice);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeNotice();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay.isConnected) closeNotice();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    closeButton.focus();
  });
}
