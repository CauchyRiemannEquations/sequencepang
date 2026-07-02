import './style.css';
import './rankingHome.css';
import './style.lovable.css';
import './updateNotes.css';
import { initGameApp } from './gameEngine.js';
import { initHomeRankingUI } from './rankingHome.js';
import { initUpdateNotesUI } from './updateNotes.js';

document.addEventListener('DOMContentLoaded', () => {
  initGameApp();
  initHomeRankingUI();
  initUpdateNotesUI();
});
