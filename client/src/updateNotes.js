export function initUpdateNotesUI() {
  const welcomeCard = document.querySelector('.welcome-card');
  if (!welcomeCard || document.getElementById('update-notes-button')) return;

  const triggerButton = document.createElement('button');
  triggerButton.type = 'button';
  triggerButton.id = 'update-notes-button';
  triggerButton.className = 'update-notes-trigger';
  triggerButton.textContent = '📋 업데이트 내역';

  const overlay = document.createElement('div');
  overlay.id = 'update-notes-overlay';
  overlay.className = 'update-notes-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="update-notes-modal" role="dialog" aria-modal="true" aria-labelledby="update-notes-title">
      <header class="update-notes-header">
        <h2 id="update-notes-title">📋 업데이트 내역</h2>
        <button type="button" class="update-notes-close" aria-label="업데이트 내역 닫기">✕</button>
      </header>
      <pre class="update-notes-content" id="update-notes-content">불러오는 중...</pre>
      <button type="button" class="update-notes-confirm">닫기</button>
    </section>
  `;

  welcomeCard.appendChild(triggerButton);
  document.body.appendChild(overlay);

  const closeButton = overlay.querySelector('.update-notes-close');
  const confirmButton = overlay.querySelector('.update-notes-confirm');
  const content = overlay.querySelector('.update-notes-content');
  let returnFocus = null;

  function closeModal() {
    overlay.classList.remove('is-open');
    overlay.hidden = true;
    returnFocus?.focus();
  }

  async function openModal() {
    returnFocus = document.activeElement;
    overlay.hidden = false;
    overlay.classList.add('is-open');
    content.textContent = '불러오는 중...';
    closeButton.focus();

    try {
      const response = await fetch(`/update-notes.md?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('update notes request failed');
      content.textContent = await response.text();
    } catch (_error) {
      content.textContent = '업데이트 내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
    }
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
