import './style.css';
import './style.lovable.css';
import './rankingHome.css';
import { initGameApp } from './gameEngine.js';
import { initHomeRankingUI } from './rankingHome.js';

document.addEventListener('DOMContentLoaded', () => {
  initGameApp();
  initHomeRankingUI();
});
