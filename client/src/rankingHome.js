import { fetchLeaderboard } from './scoreClient.js';
import { renderGlobalLeaderboard } from './ui.js';

let currentRankingPeriod = 'daily';

function makeEmptyRankItem(message) {
  const item = document.createElement('li');
  item.className = 'global-rank-empty';
  item.textContent = message;
  return item;
}

function getRankingTitle(period) {
  if (period === 'weekly') return '주간 랭킹 TOP 30';
  if (period === 'season') return '시즌 랭킹 TOP 30';
  return '오늘 랭킹 TOP 30';
}

function getRankingDescription(period) {
  if (period === 'weekly') {
    return '이번 주 최고 기록만 모아 보여줍니다.';
  }
  if (period === 'season') {
    return '현재 시즌 전체 최고 기록을 확인해보세요.';
  }
  return '오늘 기록된 최고 점수만 모아 보여줍니다.';
}

function getRankingMetaText(response) {
  if (response?.period === 'weekly') {
    return response?.rankingWeekStart ? `${response.rankingWeekStart} 시작` : '';
  }

  if (response?.period === 'season') {
    return response?.rankingSeason ? `${response.rankingSeason} 시즌` : '';
  }

  return response?.rankingDay ? `${response.rankingDay} 기준` : '';
}

function updateRankingHeader(period, response = null) {
  const title = document.getElementById('ranking-title');
  const desc = document.getElementById('ranking-desc');
  const meta = document.getElementById('ranking-period-meta');
  const dailyTab = document.getElementById('btn-ranking-daily');
  const weeklyTab = document.getElementById('btn-ranking-weekly');
  const seasonTab = document.getElementById('btn-ranking-season');

  if (title) title.textContent = getRankingTitle(period);
  if (desc) desc.textContent = getRankingDescription(period);
  if (meta) meta.textContent = getRankingMetaText(response);
  if (dailyTab) dailyTab.dataset.active = String(period === 'daily');
  if (weeklyTab) weeklyTab.dataset.active = String(period === 'weekly');
  if (seasonTab) seasonTab.dataset.active = String(period === 'season');
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
        <h2 class="ranking-title" id="ranking-title">오늘 랭킹 TOP 30</h2>
        <p class="ranking-desc" id="ranking-desc">오늘 기록된 최고 점수만 모아 보여줍니다.</p>
        <div class="ranking-period-tabs" role="tablist" aria-label="랭킹 기간 선택">
          <button type="button" class="ranking-period-tab" id="btn-ranking-daily" data-period="daily" data-active="true">오늘 랭킹</button>
          <button type="button" class="ranking-period-tab" id="btn-ranking-weekly" data-period="weekly" data-active="false">이번 주 랭킹</button>
          <button type="button" class="ranking-period-tab" id="btn-ranking-season" data-period="season" data-active="false">시즌 랭킹</button>
        </div>
        <p class="ranking-period-meta" id="ranking-period-meta"></p>
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

async function loadMainRanking(period = currentRankingPeriod) {
  const list = document.getElementById('main-ranking-list');
  if (!list) return;

  currentRankingPeriod = ['daily', 'weekly', 'season'].includes(period) ? period : 'daily';
  updateRankingHeader(currentRankingPeriod);
  list.innerHTML = '';
  list.appendChild(makeEmptyRankItem('랭킹을 불러오는 중...'));

  try {
    const response = await fetchLeaderboard(currentRankingPeriod);
    updateRankingHeader(currentRankingPeriod, response);
    renderGlobalLeaderboard(list, response.leaders || []);
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

    if (event.target?.dataset?.period) {
      loadMainRanking(event.target.dataset.period);
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
  updateRankingHeader(currentRankingPeriod);
  setupRankingOverlayEvents();
}
