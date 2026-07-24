import { LAST_SPURT_LAUNCH_AT_MS } from './gameConstants.js';

export function initHowToPlayUI() {
  const welcomeCard = document.querySelector('.welcome-card');
  if (!welcomeCard || document.getElementById('how-to-play-button')) return;

  const triggerButton = document.createElement('button');
  triggerButton.type = 'button';
  triggerButton.id = 'how-to-play-button';
  triggerButton.className = 'how-to-play-trigger';
  triggerButton.textContent = '🎮 플레이 방법';

  const rules = [
    { icon: '🍈', text: '인접한 타일을 드래그해 <strong>등차·등비수열</strong>을 만드세요 (3개 이상)' },
    { icon: '💥', text: '수열 완성 → 팡! 점수와 <strong>시간 보너스</strong> 획득 (어려운 수열일수록 보너스 UP)' },
    { icon: '🔥', text: '5초 안에 연속 성공하면 <strong>콤보 보너스</strong>가 커져요' },
    { icon: '⚠️', text: '수열이 틀리면 시간 <strong>-3초</strong>' },
    { icon: '✨', text: '<strong>4개 이상</strong> 이으면 피버 블록 등장! 터치하면 8초간 <strong>+2 · +3 · ×2</strong> 변신, 점수 ×1.5' },
    { icon: '🌟', text: '<strong>5개 이상</strong> 이으면 슈퍼피버 블록! <strong>×3 · 빅넘버(10~19)</strong>, 점수 ×2' }
  ];

  if (Date.now() >= LAST_SPURT_LAUNCH_AT_MS) {
    rules.push({ icon: '⚡', text: '<strong>라스트팡</strong>: 남은 시간 5초부터 모든 점수 ×2 (피버와 중첩!)' });
  }

  rules.push(
    { icon: '🔁', text: '같은 경로·같은 수열을 반복하면 점수가 줄어요' },
    { icon: '👑', text: '한 판에 <strong>1,000,000점</strong>을 넘기면...?' }
  );

  const overlay = document.createElement('div');
  overlay.id = 'how-to-play-overlay';
  overlay.className = 'how-to-play-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="how-to-play-modal" role="dialog" aria-modal="true" aria-labelledby="how-to-play-title">
      <header class="how-to-play-header">
        <h2 id="how-to-play-title">🎮 플레이 방법</h2>
        <button type="button" class="how-to-play-close" aria-label="플레이 방법 닫기">✕</button>
      </header>
      <ul class="how-to-play-list">
        ${rules.map(rule => `
          <li class="how-to-play-item">
            <span class="how-to-play-icon">${rule.icon}</span>
            <span class="how-to-play-text">${rule.text}</span>
          </li>
        `).join('')}
      </ul>
      <button type="button" class="how-to-play-confirm">닫기</button>
    </section>
  `;

  welcomeCard.appendChild(triggerButton);
  document.body.appendChild(overlay);

  const closeButton = overlay.querySelector('.how-to-play-close');
  const confirmButton = overlay.querySelector('.how-to-play-confirm');
  let returnFocus = null;

  function closeModal() {
    overlay.classList.remove('is-open');
    overlay.hidden = true;
    returnFocus?.focus();
  }

  function openModal() {
    returnFocus = document.activeElement;
    overlay.hidden = false;
    overlay.classList.add('is-open');
    closeButton.focus();
  }

  triggerButton.addEventListener('click', openModal);
  closeButton.addEventListener('click', closeModal);
  confirmButton.addEventListener('click', closeModal);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) closeModal();
  });
}
