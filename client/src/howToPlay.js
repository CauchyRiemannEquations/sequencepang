import { LAST_SPURT_LAUNCH_AT_MS } from './gameConstants.js';

export function initHowToPlayUI() {
  const welcomeCard = document.querySelector('.welcome-card');
  if (!welcomeCard || document.getElementById('how-to-play-button')) return;

  const triggerButton = document.createElement('button');
  triggerButton.type = 'button';
  triggerButton.id = 'how-to-play-button';
  triggerButton.className = 'how-to-play-trigger';
  triggerButton.textContent = '플레이 방법';

  const isLastSpurtLive = Date.now() >= LAST_SPURT_LAUNCH_AT_MS;

  const demoBasic = `
    <section class="htp-section">
      <div class="htp-stage htp-demo-basic">
        <div class="htp-tile b1"><span>2</span></div>
        <div class="htp-tile x1"><span>7</span></div>
        <div class="htp-tile b3"><span>6</span></div>
        <div class="htp-tile x2"><span>5</span></div>
        <div class="htp-tile b2"><span>4</span></div>
        <div class="htp-tile x3"><span>9</span></div>
        <svg class="htp-line-svg" aria-hidden="true"><path class="htp-line" d="M86 32 L162 84 L238 32"/></svg>
        <div class="htp-pop">팡! +300</div>
        <div class="htp-finger">👆</div>
      </div>
      <p class="htp-caption">인접한 타일을 드래그해 <strong>등차·등비수열</strong>(3개 이상)을 만드세요 — 가로·세로·<strong>대각선</strong> 어느 방향이든 OK! 5초 안에 연속 성공하면 <strong>콤보</strong>가 커져요</p>
    </section>`;

  const demoFever = `
    <section class="htp-section">
      <div class="htp-stage htp-demo-fever">
        <div class="htp-tile f1"><span class="nb">1</span><span class="nf">3</span></div>
        <div class="htp-tile f2"><span class="nb">3</span><span class="ns">+2</span><span class="nf">5</span></div>
        <div class="htp-tile f3"><span class="nb">5</span><span class="nf">7</span></div>
        <div class="htp-tile f4"><span class="nb">7</span><span class="nf">9</span></div>
        <svg class="htp-line-svg" aria-hidden="true"><path class="htp-line" d="M46 48 L238 48"/></svg>
        <div class="htp-pop">피버 블록 등장!</div>
        <div class="htp-finger">👆</div>
      </div>
      <p class="htp-caption"><strong>4개 이상</strong> 이으면 피버 블록 등장! 터치하면 8초간 보드가 <strong>+2 · +3 · ×2</strong>로 변신, 점수 ×1.5</p>
    </section>`;

  const demoSuper = `
    <section class="htp-section">
      <div class="htp-stage htp-demo-super">
        <div class="htp-tile s1"><span class="nb">1</span><span class="nf">3</span></div>
        <div class="htp-tile s2"><span class="nb">3</span><span class="nf">9</span></div>
        <div class="htp-tile s3"><span class="nb">5</span><span class="ns">×3</span><span class="nf">15</span></div>
        <div class="htp-tile s4"><span class="nb">7</span><span class="nf">21</span></div>
        <div class="htp-tile s5"><span class="nb">9</span><span class="nf">27</span></div>
        <svg class="htp-line-svg" aria-hidden="true"><path class="htp-line" d="M36 48 L276 48"/></svg>
        <div class="htp-pop">슈퍼피버!</div>
        <div class="htp-finger">👆</div>
      </div>
      <p class="htp-caption"><strong>5개 이상</strong> 이으면 슈퍼피버 블록! <strong>×3 변신</strong> 또는 <strong>빅넘버(10~19)</strong> 등장, 점수 ×2</p>
    </section>`;

  const demoGrid = Array.from({ length: 25 }, () => '<i aria-hidden="true"></i>').join('');

  const demoPang = `
    <section class="htp-section">
      <div class="htp-stage htp-demo-pang">
        <div class="htp-pang-card htp-pang-cross">
          <span class="htp-pang-count">6개 연쇄</span>
          <strong>크로스팡!</strong>
          <div class="htp-mini-grid" aria-hidden="true">${demoGrid}</div>
          <small>마지막 칸의 가로·세로 제거</small>
        </div>
        <div class="htp-pang-card htp-pang-full">
          <span class="htp-pang-count">7개 이상 연쇄</span>
          <strong>풀보드팡!</strong>
          <div class="htp-mini-grid" aria-hidden="true">${demoGrid}</div>
          <small>보드 전체를 한 번에 재생성</small>
        </div>
      </div>
      <p class="htp-caption"><strong>6개</strong>를 이으면 크로스팡, <strong>7개 이상</strong>을 이으면 풀보드팡! 추가 타일마다 점수와 시간 보너스도 받아요</p>
    </section>`;

  const demoHyper = `
    <section class="htp-section">
      <div class="htp-stage htp-demo-hyper">
        <span class="htp-hyper-score">1,000,000점 돌파</span>
        <strong class="htp-hyper-title">하이퍼팡!</strong>
        <div class="htp-hyper-tiles" aria-hidden="true">
          <span>9</span><span>10</span><span>11</span><span>12</span>
        </div>
        <span class="htp-hyper-time">+5초</span>
      </div>
      <p class="htp-caption">한 판에 <strong>1,000,000점</strong>을 넘기면 하이퍼팡 발동! 보드가 새로 생성되고 숫자 범위가 <strong>1~12</strong>로 확장돼요</p>
    </section>`;

  const demoLastPang = `
    <section class="htp-section">
      <div class="htp-stage htp-demo-last">
        <div class="htp-timer-track"><div class="htp-timer-fill"></div></div>
        <div class="htp-last-badge">라스트팡! ×2</div>
      </div>
      <p class="htp-caption">남은 시간이 처음 <strong>5초</strong> 아래로 내려가면 발동 — 이후 게임이 끝날 때까지 모든 점수 <strong>×2</strong>! 피버 배율과 중첩</p>
    </section>`;

  const textRules = `
    <ul class="how-to-play-list">
      <li class="how-to-play-item"><span class="how-to-play-text">수열이 틀리면 시간 <strong>-3초</strong></span></li>
      <li class="how-to-play-item"><span class="how-to-play-text">같은 경로·같은 수열을 반복하면 점수가 줄어요</span></li>
    </ul>`;

  const overlay = document.createElement('div');
  overlay.id = 'how-to-play-overlay';
  overlay.className = 'how-to-play-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="how-to-play-modal" role="dialog" aria-modal="true" aria-labelledby="how-to-play-title">
      <header class="how-to-play-header">
        <h2 id="how-to-play-title">플레이 방법</h2>
        <button type="button" class="how-to-play-close" aria-label="플레이 방법 닫기">✕</button>
      </header>
      <div class="how-to-play-scroll">
        ${demoBasic}
        ${demoFever}
        ${demoSuper}
        ${demoPang}
        ${isLastSpurtLive ? demoLastPang : ''}
        ${demoHyper}
        ${textRules}
      </div>
      <button type="button" class="how-to-play-confirm">닫기</button>
    </section>
  `;

  (document.getElementById('welcome-links-row') || welcomeCard).appendChild(triggerButton);
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
