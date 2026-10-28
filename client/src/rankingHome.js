import { fetchLeaderboard, peekLeaderboard } from './scoreClient.js';
import { renderGlobalLeaderboard } from './ui.js';
import { formatWeekRange } from './rankingDates.js';

let currentRankingPeriod = 'daily';
let rankingRequestId = 0;
let rankingOpener = null;

function makeEmptyRankItem(message) {
  const item = document.createElement('li');
  item.className = 'global-rank-empty';
  item.textContent = message;
  return item;
}

function getRankingTitle(period) {
  if (period === 'weekly') return '주간 랭킹 TOP 30';
  return '오늘 랭킹 TOP 30';
}

function getRankingDescription(period) {
  if (period === 'weekly') {
    return '이번 주 최고 기록만 모아 보여줍니다.';
  }
  return '오늘 기록된 최고 점수만 모아 보여줍니다.';
}

function getRankingMetaText(response) {
  if (response?.period === 'weekly') {
    return response?.rankingWeekStart ? formatWeekRange(response.rankingWeekStart) : '';
  }

  return response?.rankingDay || '';
}

function updateRankingHeader(period, response = null, status = '') {
  const title = document.getElementById('ranking-title');
  const desc = document.getElementById('ranking-desc');
  const meta = document.getElementById('ranking-period-meta');
  const dailyTab = document.getElementById('btn-ranking-daily');
  const weeklyTab = document.getElementById('btn-ranking-weekly');

  if (title) title.textContent = getRankingTitle(period);
  if (desc) desc.textContent = getRankingDescription(period);
  if (meta) meta.textContent = [getRankingMetaText(response), status].filter(Boolean).join(' · ');
  for (const button of [dailyTab, weeklyTab]) {
    if (!button) continue;
    const active = button.dataset.period === period;
    button.dataset.active = String(active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function createRankingOverlay() {
  const existing = document.getElementById('ranking-overlay');
  if (existing) return existing;

  const overlay = document.createElement('dialog');
  overlay.className = 'overlay ranking-overlay';
  overlay.id = 'ranking-overlay';
  overlay.setAttribute('aria-labelledby', 'ranking-title');
  overlay.setAttribute('aria-describedby', 'ranking-desc');
  overlay.addEventListener('close', () => {
    // A queued close event must not hide a dialog that was already reopened.
    if (overlay.open) return;
    overlay.classList.remove('show');
    rankingRequestId++;
    if (rankingOpener?.isConnected) rankingOpener.focus();
    rankingOpener = null;
  });

  overlay.innerHTML = `
    <div class="ranking-card">
      <div class="ranking-card-header">
        <h2 class="ranking-title" id="ranking-title">오늘 랭킹 TOP 30</h2>
        <p class="ranking-desc" id="ranking-desc">오늘 기록된 최고 점수만 모아 보여줍니다.</p>
        <div class="ranking-period-tabs" role="group" aria-label="랭킹 기간 선택">
          <button type="button" class="ranking-period-tab" id="btn-ranking-daily" data-period="daily" data-active="true" aria-pressed="true">오늘 랭킹</button>
          <button type="button" class="ranking-period-tab" id="btn-ranking-weekly" data-period="weekly" data-active="false" aria-pressed="false">주간 랭킹</button>
        </div>
        <p class="ranking-period-meta" id="ranking-period-meta" aria-live="polite"></p>
      </div>

      <ol class="global-ranking-list main-ranking-list" id="main-ranking-list">
        <li class="global-rank-empty">랭킹을 불러오는 중...</li>
      </ol>

      <button type="button" class="btn-retry" id="btn-ranking-close" autofocus>닫기</button>
    </div>
  `;

  // 주의: game-layout은 좁은 화면에서 transform: scale이 걸리는데, transform이 있는
  // 조상 안에서는 position: fixed가 뷰포트 대신 조상 기준이 되어 화면 고정이 깨진다.
  // 다른 모달들처럼 body에 직접 붙여 항상 뷰포트에 고정되게 한다.
  document.body.appendChild(overlay);
  return overlay;
}

async function loadMainRanking(period = currentRankingPeriod) {
  const list = document.getElementById('main-ranking-list');
  if (!list) return;

  currentRankingPeriod = period === 'weekly' ? 'weekly' : 'daily';
  const requestedPeriod = currentRankingPeriod;
  const requestId = ++rankingRequestId;
  const cached = peekLeaderboard(requestedPeriod);
  updateRankingHeader(requestedPeriod, cached?.payload, cached?.stale ? '업데이트 중…' : '');
  if (cached) {
    renderGlobalLeaderboard(list, cached.payload.leaders || []);
  } else {
    list.innerHTML = '';
    list.appendChild(makeEmptyRankItem('랭킹을 불러오는 중...'));
  }

  try {
    const response = await fetchLeaderboard(requestedPeriod);
    if (requestId !== rankingRequestId) return;
    updateRankingHeader(requestedPeriod, response);
    renderGlobalLeaderboard(list, response.leaders || []);
  } catch (error) {
    if (requestId !== rankingRequestId) return;
    const current = peekLeaderboard(requestedPeriod);
    if (current) {
      renderGlobalLeaderboard(list, current.payload.leaders || []);
      updateRankingHeader(requestedPeriod, current.payload, '업데이트 실패 · 이전 기록 표시');
    } else {
      list.innerHTML = '';
      list.appendChild(makeEmptyRankItem(error.message || '랭킹을 불러오지 못했습니다.'));
    }
  }
}

function openRankingOverlay() {
  const overlay = createRankingOverlay();
  if (!overlay || overlay.open) return;

  rankingOpener = document.activeElement;
  overlay.showModal();
  overlay.classList.add('show');
  loadMainRanking();
}

function closeRankingOverlay() {
  const overlay = document.getElementById('ranking-overlay');
  if (overlay?.open) {
    rankingRequestId++;
    overlay.classList.remove('show');
    overlay.close();
  }
}

function setupMainButtons() {
  const singleButton = document.getElementById('btn-single-start');
  const multiButton = document.getElementById('btn-multi-lobby');
  const rankingButton = document.getElementById('btn-show-ranking');

  if (!singleButton || !multiButton || !rankingButton) return;

  singleButton.classList.add('btn-main-play');
  multiButton.classList.add('btn-sub-action');
  multiButton.textContent = '다함께 팡!';
  rankingButton.className = 'btn-start btn-sub-action btn-ranking-open';
  rankingButton.textContent = '랭킹 보기';

  rankingButton.addEventListener('click', openRankingOverlay);
}

function setupRankingOverlayEvents() {
  document.addEventListener('click', event => {
    if (event.target?.id === 'btn-ranking-close') {
      closeRankingOverlay();
    }

    if (event.target?.closest?.('#ranking-overlay .ranking-period-tab')) {
      loadMainRanking(event.target.dataset.period);
    }

    if (event.target?.id === 'ranking-overlay') {
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
