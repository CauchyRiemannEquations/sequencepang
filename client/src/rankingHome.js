import { fetchLeaderboard } from './scoreClient.js';
import { renderGlobalLeaderboard } from './ui.js';

function makeEmptyRankItem(message) {
  const item = document.createElement('li');
  item.className = 'global-rank-empty';
  item.textContent = message;
  return item;
}

function createRankingOverlay() {
  const gameContainer = document.getElementById('game-container');
  if (!gameContainer) return null;

  const existing = document.getElementById('ranking-overlay');
  if (existing) return existing;

  const overlay = document.createElement('div');
  overlay.className = 'overlay ranking-overlay';
  overlay.id = 'ranking-overlay';

  overlay.innerHTML = `
    <div class="ranking-card" role="dialog" aria-modal="true" aria-labelledby="ranking-title">
      <div class="ranking-card-header">
        <h2 class="ranking-title" id="ranking-title">전체 랭킹 TOP 10</h2>
        <p class="ranking-desc">최신 기록을 바로 확인해보세요.</p>
      </div>

      <ol class="global-ranking-list main-ranking-list" id="main-ranking-list">
        <li class="global-rank-empty">랭킹을 불러오는 중...</li>
      </ol>

      <button type="button" class="btn-retry" id="btn-ranking-close">닫기</button>
    </div>
  `;

  gameContainer.appendChild(overlay);
  return overlay;
}

async function loadMainRanking() {
  const list = document.getElementById('main-ranking-list');
  if (!list) return;

  list.innerHTML = '';
  list.appendChild(makeEmptyRankItem('랭킹을 불러오는 중...'));

  try {
    const { leaders = [] } = await fetchLeaderboard();
    renderGlobalLeaderboard(list, leaders);
  } catch (error) {
    list.innerHTML = '';
    list.appendChild(makeEmptyRankItem(error.message || '랭킹을 불러오지 못했습니다.'));
  }
}

function openRankingOverlay() {
  const overlay = createRankingOverlay();
  if (!overlay) return;

  overlay.classList.add('show');
  loadMainRanking();
}

function closeRankingOverlay() {
  const overlay = document.getElementById('ranking-overlay');
  if (overlay) overlay.classList.remove('show');
}

function setupMainButtons() {
  const modeSelection = document.getElementById('mode-selection');
  const singleButton = document.getElementById('btn-single-start');
  const multiButton = document.getElementById('btn-multi-lobby');

  if (!modeSelection || !singleButton || !multiButton) return;
  if (document.getElementById('btn-show-ranking')) return;

  singleButton.classList.add('btn-main-play');
  multiButton.classList.add('btn-sub-action');
  multiButton.textContent = '다함께 팡!';

  const subActions = document.createElement('div');
  subActions.className = 'main-sub-actions';

  modeSelection.insertBefore(subActions, multiButton);
  subActions.appendChild(multiButton);

  const rankingButton = document.createElement('button');
  rankingButton.type = 'button';
  rankingButton.id = 'btn-show-ranking';
  rankingButton.className = 'btn-start btn-sub-action btn-ranking-open';
  rankingButton.textContent = '랭킹 보기';

  subActions.appendChild(rankingButton);
  rankingButton.addEventListener('click', openRankingOverlay);
}

function setupRankingOverlayEvents() {
  document.addEventListener('click', event => {
    if (event.target?.id === 'btn-ranking-close') {
      closeRankingOverlay();
    }

    if (event.target?.id === 'ranking-overlay') {
      closeRankingOverlay();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeRankingOverlay();
    }
  });
}

export function initHomeRankingUI() {
  setupMainButtons();
  createRankingOverlay();
  setupRankingOverlayEvents();
}
