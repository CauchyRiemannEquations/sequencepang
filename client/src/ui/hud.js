// HUD(점수·콤보·타이머·피버 패널) DOM 갱신 전담.
// 게임 상태 판단은 gameEngine이 하고, 여기는 표시만 한다.

export function createHud({
  scoreVal,
  bestScoreVal,
  welcomeBestVal,
  comboVal,
  comboBadge,
  timerContainer,
  timerBar,
  timerText,
  feverPanel,
  feverTimerFill,
  feverTimerText
}) {
  let scorePopTimer = null;

  function setScore(score, { pop = false } = {}) {
    scoreVal.textContent = score;
    if (pop) {
      scoreVal.classList.add('pop');
      if (scorePopTimer) clearTimeout(scorePopTimer);
      scorePopTimer = setTimeout(() => scoreVal.classList.remove('pop'), 150);
    }
  }

  function setBestScore(bestScore) {
    bestScoreVal.textContent = bestScore;
    welcomeBestVal.textContent = bestScore;
  }

  function setCombo(combo, secondsLeft) {
    comboVal.textContent = combo;
    comboBadge.style.display = 'inline-block';
    comboBadge.textContent = `🔥 ${secondsLeft.toFixed(1)}s`;
  }

  function setComboSeconds(secondsLeft) {
    comboBadge.textContent = `🔥 ${secondsLeft.toFixed(1)}s`;
  }

  function clearCombo() {
    comboVal.textContent = '0';
    comboBadge.style.display = 'none';
    comboBadge.textContent = '🔥';
  }

  function setTimer(timeLeft, maxTime) {
    const percentage = (timeLeft / maxTime) * 100;
    timerBar.style.width = `${percentage}%`;
    timerText.textContent = `${timeLeft.toFixed(1)}s`;
    timerBar.classList.toggle('warning', timeLeft < 15);
  }

  function setFeverPanel({ visible, superActive, percentage, text }) {
    feverPanel.classList.toggle('show', visible);
    feverPanel.classList.toggle('super-fever', superActive);
    feverTimerFill.style.width = `${percentage}%`;
    feverTimerText.textContent = text;
  }

  function setLastSpurt(active) {
    timerContainer.classList.toggle('last-spurt', active);
  }

  return {
    setScore,
    setBestScore,
    setCombo,
    setComboSeconds,
    clearCombo,
    setTimer,
    setFeverPanel,
    setLastSpurt
  };
}
