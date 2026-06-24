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
