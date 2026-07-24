import { initMenuBgm } from './menuBgm.js';
import './style.css';
import './rankingHome.css';
import './style.lovable.css';
import './updateNotes.css';
import './rankingResetNotice.css';
import './superFeverNotice.css';
import './howToPlay.css';
import { initGameApp } from './gameEngine.js';
import { initHomeRankingUI } from './rankingHome.js';
import { initUpdateNotesUI } from './updateNotes.js';
import { initSfx } from './sfxManager.js';
import { initRankingResetNotice } from './rankingResetNotice.js';
import { initSuperFeverNotice } from './superFeverNotice.js';
import { initHowToPlayUI } from './howToPlay.js';

function ensureWelcomeLinksRow() {
  const welcomeCard = document.querySelector('.welcome-card');
  if (!welcomeCard) return null;

  let linksRow = document.getElementById('welcome-links-row');
  if (!linksRow) {
    linksRow = document.createElement('div');
    linksRow.id = 'welcome-links-row';
    linksRow.className = 'welcome-links-row';
    welcomeCard.appendChild(linksRow);
  }
  return linksRow;
}

function initContactLink() {
  const linksRow = ensureWelcomeLinksRow();
  if (!linksRow || document.getElementById('contact-link')) return;

  const contactLink = document.createElement('a');
  contactLink.id = 'contact-link';
  contactLink.className = 'contact-link';
  contactLink.href = 'mailto:crequationsmath@gmail.com';
  contactLink.textContent = 'Contact';
  contactLink.title = '문의사항은 이메일로 보내주세요';
  linksRow.appendChild(contactLink);
}

document.addEventListener('DOMContentLoaded', () => {
  initSfx();
  initHomeRankingUI();
  initGameApp();
  ensureWelcomeLinksRow();
  initHowToPlayUI();
  initUpdateNotesUI();
  initContactLink();
  initMenuBgm();
  initRankingResetNotice();
  initSuperFeverNotice();
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .catch(error => {
        console.warn('Service worker registration failed:', error);
      });
  });
}
