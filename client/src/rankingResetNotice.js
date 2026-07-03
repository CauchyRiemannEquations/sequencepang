const RANKING_RESET_AT_MS = Date.parse('2026-07-05T15:00:00.000Z');
const NOTICE_DISMISSED_KEY = 'sequencepang-ranking-reset-2026-07-06-dismissed-v2';

export function initRankingResetNotice() {
  if (Date.now() >= RANKING_RESET_AT_MS) return;
  if (localStorage.getItem(NOTICE_DISMISSED_KEY) === 'true') return;

  const overlay = document.createElement('div');
  overlay.className = 'ranking-reset-notice-overlay';
  overlay.innerHTML = `
    <section class="ranking-reset-notice" role="dialog" aria-modal="true" aria-labelledby="ranking-reset-notice-title">
      <span class="ranking-reset-notice-icon" aria-hidden="true">🏆</span>
      <p class="ranking-reset-notice-eyebrow">NEW SEASON</p>
      <h2 id="ranking-reset-notice-title">랭킹 초기화 안내</h2>
      <p class="ranking-reset-notice-date">7월 6일 00:00</p>
      <p class="ranking-reset-notice-copy">
        새로운 랭킹 시즌이 시작됩니다.<br>
        기존 기록은 안전하게 보관됩니다.
      </p>
      <div class="ranking-reset-notice-actions">
        <button type="button" class="ranking-reset-notice-close">닫기</button>
        <button type="button" class="ranking-reset-notice-dismiss">다시 보지 않기</button>
      </div>
    </section>
  `;

  const closeButton = overlay.querySelector('.ranking-reset-notice-close');
  const dismissButton = overlay.querySelector('.ranking-reset-notice-dismiss');

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
