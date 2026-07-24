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

document.addEventListener('DOMContentLoaded', () => {
  initSfx();
  initHomeRankingUI();
  initGameApp();
  initHowToPlayUI();
  initUpdateNotesUI();
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
