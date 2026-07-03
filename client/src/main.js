import { initMenuBgm } from './menuBgm.js';
import './style.css';
import './rankingHome.css';
import './style.lovable.css';
import './updateNotes.css';
import './rankingResetNotice.css';
import { initGameApp } from './gameEngine.js';
import { initHomeRankingUI } from './rankingHome.js';
import { initUpdateNotesUI } from './updateNotes.js';
import { initSfx } from './sfxManager.js';
import { initRankingResetNotice } from './rankingResetNotice.js';

document.addEventListener('DOMContentLoaded', () => {
  initSfx();
  initGameApp();
  initHomeRankingUI();
  initUpdateNotesUI();
  initMenuBgm();
  initRankingResetNotice();
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
