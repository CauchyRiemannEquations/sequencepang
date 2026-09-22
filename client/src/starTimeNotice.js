import {
  STAR_REQUIRED, STAR_TIME_DURATION, STAR_TIME_EXTENSION, STAR_TIME_MAX, STAR_SCORE_MULTIPLIER
} from './gameConstants.js';

const SEEN_KEY = 'sequencepang-star-time-intro-v1-dismissed';

export function initStarTimeNotice() {
  const home = document.getElementById('welcome-overlay');
  if (!home || home.classList.contains('hide') || document.getElementById('star-time-notice')) return;
  try { if (localStorage.getItem(SEEN_KEY) === 'true') return; } catch { /* 저장 불가여도 게임은 계속 이용 가능 */ }

  const dialog = document.createElement('dialog');
  dialog.id = 'star-time-notice';
  dialog.className = 'sequel-launch-notice star-time-notice';
  dialog.setAttribute('aria-labelledby', 'star-time-notice-title');
  dialog.setAttribute('aria-describedby', 'star-time-notice-copy');
  dialog.innerHTML = `
    <div class="star-intro-tile" aria-hidden="true"><span>★</span>7</div>
    <p class="sequel-launch-eyebrow">NEW BONUS</p>
    <h2 id="star-time-notice-title">STAR TIME!</h2>
    <p id="star-time-notice-copy">평소보다 조금 더 신나는 <strong>${STAR_TIME_DURATION}초</strong></p>
    <div class="star-intro-gauge" aria-hidden="true">${'★'.repeat(STAR_REQUIRED)}</div>
    <p class="star-intro-rule">별 숫자가 들어간 수열을 지워<br><strong>별 ${STAR_REQUIRED}개</strong>를 모아 보세요!</p>
    <div class="star-intro-benefits">
      <span><strong>점수 ×${STAR_SCORE_MULTIPLIER}</strong>모든 수열 점수에 적용</span>
      <span><strong>콤보 시간 보호</strong>남은 콤보 시간이 멈춰요</span>
    </div>
    <p class="sequel-launch-detail">STAR TIME 중 추가 별은 <strong>+${STAR_TIME_EXTENSION}초</strong><br>최대 ${STAR_TIME_MAX}초까지 연장돼요.</p>
    <button class="sequel-launch-play star-intro-close" type="button" autofocus>좋아요!</button>
    <p class="sequel-launch-footnote">이 기기에서는 한 번만 안내해요.</p>
  `;
  if (typeof dialog.showModal !== 'function') return;
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => {
    try { localStorage.setItem(SEEN_KEY, 'true'); } catch { /* 다음 방문에 다시 안내 가능 */ }
    dialog.remove();
  }, { once: true });
  dialog.querySelector('.star-intro-close').addEventListener('click', () => dialog.close());
  dialog.showModal();
}
