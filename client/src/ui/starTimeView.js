// 고정 높이 HUD: 발동·연장 알림이 보드나 기존 토스트를 가리지 않는다.
export function createStarTimeView({ panel, boardWrapper, required, multiplier }) {
  const gauge = panel.querySelector('.star-gauge');
  const label = panel.querySelector('.star-label');
  const timer = panel.querySelector('.star-timer');
  const feedback = panel.querySelector('.star-feedback');
  const stars = Array.from({ length: required }, () => {
    const star = document.createElement('span');
    star.textContent = '☆';
    star.setAttribute('aria-hidden', 'true');
    gauge.appendChild(star);
    return star;
  });
  let feedbackTimer = null;
  let wasActive = false;

  function render({ starCount, isStarTime, starTimeRemaining }) {
    if (wasActive && !isStarTime) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
      feedback.textContent = '';
    }
    wasActive = isStarTime;
    panel.classList.toggle('is-active', isStarTime);
    boardWrapper.classList.toggle('star-time-active', isStarTime);
    label.textContent = isStarTime ? 'STAR TIME' : 'STAR';
    gauge.hidden = isStarTime;
    gauge.setAttribute('aria-label', `별 ${starCount} / ${required}`);
    stars.forEach((star, index) => {
      star.textContent = index < starCount ? '★' : '☆';
      star.classList.toggle('is-filled', index < starCount);
    });
    timer.hidden = !isStarTime;
    timer.textContent = isStarTime ? `${starTimeRemaining.toFixed(1)}s · 점수 ×${multiplier}` : '';
  }

  function notify(message) {
    clearTimeout(feedbackTimer);
    feedback.textContent = message;
    feedbackTimer = setTimeout(() => {
      feedback.textContent = '';
      feedbackTimer = null;
    }, 1400);
  }

  function reset(state) {
    clearTimeout(feedbackTimer);
    feedbackTimer = null;
    feedback.textContent = '';
    render(state);
  }

  return { render, notify, reset };
}
