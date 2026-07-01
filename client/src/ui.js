export function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

export function renderLeaderboard(listElement, players, currentNickname) {
  listElement.innerHTML = '';

  players.forEach((player, index) => {
    const isMe = player.nickname === currentNickname;
    const rank = index + 1;
    let rankEmoji = `${rank}등`;
    if (rank === 1) rankEmoji = '👑 1등';
    else if (rank === 2) rankEmoji = '🥈 2등';
    else if (rank === 3) rankEmoji = '🥉 3등';

    const item = document.createElement('div');
    item.className = `leaderboard-item ${isMe ? 'is-me' : ''} rank-${rank}`;
    item.innerHTML = `
      <div class="rank-badge">${rankEmoji}</div>
      <div class="player-info">
        <span class="player-name">${escapeHTML(player.nickname)}${isMe ? ' <small>(나)</small>' : ''}</span>
      </div>
      <div class="player-score">${player.score.toLocaleString()}점</div>
    `;
    listElement.appendChild(item);
  });
}

export function renderGlobalLeaderboard(listElement, leaders) {
  listElement.innerHTML = '';

  if (!leaders.length) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'global-rank-empty';
    emptyItem.textContent = '아직 등록된 기록이 없습니다.';
    listElement.appendChild(emptyItem);
    return;
  }

  leaders.forEach((leader, index) => {
    const item = document.createElement('li');
    item.className = `global-rank-item rank-${index + 1}`;

    const rank = document.createElement('span');
    rank.className = 'global-rank-number';
    rank.textContent = index < 3 ? ['🥇', '🥈', '🥉'][index] : `${index + 1}`;

    const nickname = document.createElement('span');
    nickname.className = 'global-rank-nickname';
    nickname.textContent = leader.nickname;

    const combo = document.createElement('span');
    combo.className = 'global-rank-combo';
    combo.textContent = `최대 ${leader.maxCombo}콤보`;

    const score = document.createElement('strong');
    score.className = 'global-rank-score';
    score.textContent = `${leader.score.toLocaleString('ko-KR')}점`;

    item.append(rank, nickname, combo, score);
    listElement.appendChild(item);
  });
}
