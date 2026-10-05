// Fixed campaign dates: returning later or deploying again must not extend it.
export const LAUNCH_NOTICE_START = Date.parse('2026-10-05T00:00:00+09:00');
export const LAUNCH_NOTICE_END = LAUNCH_NOTICE_START + 7 * 24 * 60 * 60 * 1000;
const SEEN_KEY = 'sequencepang-sequel3-launch-2026-10-seen-day';

export function launchNoticeDay(now) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function shouldShowLaunchNotice(now, seenDay) {
  return Number.isFinite(now) && now >= LAUNCH_NOTICE_START && now < LAUNCH_NOTICE_END
    && seenDay !== launchNoticeDay(now);
}

export function initSequelLaunchNotice({ onComplete = () => {} } = {}) {
  const home = document.getElementById('welcome-overlay');
  if (!home || home.classList.contains('hide') || document.getElementById('sequel-launch-notice')) return;
  const now = Date.now();
  let seenDay;
  try { seenDay = localStorage.getItem(SEEN_KEY); } catch { /* Storage can be disabled. */ }
  if (!shouldShowLaunchNotice(now, seenDay)) { onComplete(); return; }

  const dialog = document.createElement('dialog');
  dialog.id = 'sequel-launch-notice';
  dialog.className = 'sequel-launch-notice';
  dialog.setAttribute('aria-labelledby', 'sequel-launch-title');
  dialog.setAttribute('aria-describedby', 'sequel-launch-copy');
  dialog.innerHTML = `
    <img class="sequel-launch-mascot" src="https://sequencepang3.vercel.app/coconut/icons/icon-512.png" alt="시퀀스팡3 코코넛" width="104" height="104">
    <p class="sequel-launch-eyebrow">NEW GAME</p>
    <h2 id="sequel-launch-title">시퀀스팡3 출시!</h2>
    <p id="sequel-launch-copy">열린 패 세 개로<br><strong>등차·등비수열</strong>을 완성해요!</p>
    <p class="sequel-launch-detail">시간제한 없이 차근차근,<br>쌓인 패를 모두 지워 보세요.</p>
    <a class="sequel-launch-play" href="https://sequencepang3.vercel.app/" target="_blank" rel="noopener noreferrer">시퀀스팡3 하러 가기<span class="sequel-launch-new-tab">새 탭에서 열려요</span></a>
    <button class="sequel-launch-close" type="button" autofocus>닫기</button>
    <p class="sequel-launch-footnote">이 안내는 하루에 한 번만 보여요.</p>
  `;
  document.body.appendChild(dialog);
  if (typeof dialog.showModal !== 'function') { dialog.remove(); onComplete(); return; }
  dialog.showModal();
  try { localStorage.setItem(SEEN_KEY, launchNoticeDay(now)); } catch { /* The game remains usable. */ }

  const close = () => dialog.close();
  const expire = () => { if (Date.now() >= LAUNCH_NOTICE_END) close(); };
  const expiryTimer = setTimeout(expire, Math.max(0, LAUNCH_NOTICE_END - Date.now()));
  document.addEventListener('visibilitychange', expire);
  dialog.querySelector('.sequel-launch-close').addEventListener('click', close);
  dialog.querySelector('.sequel-launch-play').addEventListener('click', close);
  dialog.addEventListener('close', () => {
    clearTimeout(expiryTimer);
    document.removeEventListener('visibilitychange', expire);
    dialog.remove();
    onComplete();
  }, { once: true });
}
