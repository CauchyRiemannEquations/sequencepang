const RANKING_RESET_AT_MS = Date.parse('2026-07-05T15:00:00.000Z');
const NOTICE_SEEN_KEY = 'sequencepang-ranking-reset-2026-07-06-seen';

export function initRankingResetNotice() {
  if (Date.now() >= RANKING_RESET_AT_MS) return;
  if (localStorage.getItem(NOTICE_SEEN_KEY) === 'true') return;

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
      <button type="button" class="ranking-reset-notice-close">확인했어요</button>
    </section>
  `;

  const closeButton = overlay.querySelector('.ranking-reset-notice-close');

  function closeNotice() {
    localStorage.setItem(NOTICE_SEEN_KEY, 'true');
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
  }

  closeButton.addEventListener('click', closeNotice);
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
