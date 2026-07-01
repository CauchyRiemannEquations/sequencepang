const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getScoreFirestore } = require('./firestore');
const {
  ALLOWED_SCORE_MODES,
  MAX_ACCEPTED_SCORE,
  MAX_ACCEPTED_COMBO,
  SCORE_VERSION
} = require('./constants');

const scoreRouter = express.Router();

function validateScorePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: '올바른 점수 데이터가 필요합니다.' };
  }

  const nickname = typeof payload.nickname === 'string' ? payload.nickname.trim() : '';
  const nicknameLength = Array.from(nickname).length;
  if (nicknameLength < 1 || nicknameLength > 10) {
    return { error: '닉네임은 1~10자로 입력해주세요.' };
  }

  const score = payload.score;
  if (!Number.isSafeInteger(score) || score < 0 || score > MAX_ACCEPTED_SCORE) {
    return { error: `점수는 0~${MAX_ACCEPTED_SCORE.toLocaleString('ko-KR')} 범위의 정수여야 합니다.` };
  }

  const maxCombo = payload.maxCombo;
  if (!Number.isSafeInteger(maxCombo) || maxCombo < 0 || maxCombo > MAX_ACCEPTED_COMBO) {
    return { error: '최대 콤보 값이 올바르지 않습니다.' };
  }

  if (!ALLOWED_SCORE_MODES.has(payload.mode)) {
    return { error: '허용되지 않은 게임 모드입니다.' };
  }

  return {
    value: {
      nickname,
      score,
      maxCombo,
      mode: payload.mode
    }
  };
}

function firestoreUnavailable(res) {
  return res.status(503).json({ error: '랭킹 서버가 아직 설정되지 않았습니다.' });
}

scoreRouter.post('/scores', async (req, res) => {
  const validation = validateScorePayload(req.body);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const firestore = getScoreFirestore();
  if (!firestore) return firestoreUnavailable(res);

  try {
    const document = await firestore.collection('scores').add({
      ...validation.value,
      createdAt: FieldValue.serverTimestamp(),
      version: SCORE_VERSION
    });
    return res.status(201).json({ ok: true, id: document.id });
  } catch (error) {
    console.error('❌ 점수 저장 실패:', error.message);
    return res.status(500).json({ error: '점수를 저장하지 못했습니다.' });
  }
});

scoreRouter.get('/leaderboard', async (_req, res) => {
  const firestore = getScoreFirestore();
  if (!firestore) return firestoreUnavailable(res);

  try {
    const snapshot = await firestore
      .collection('scores')
      .orderBy('score', 'desc')
      .limit(10)
      .get();

    const leaders = snapshot.docs.map(document => {
      const data = document.data();
      return {
        nickname: data.nickname,
        score: data.score,
        maxCombo: data.maxCombo,
        mode: data.mode,
        createdAt: data.createdAt?.toDate?.().toISOString() || null
      };
    });

    res.set('Cache-Control', 'no-store');
    return res.json({ leaders });
  } catch (error) {
    console.error('❌ 랭킹 조회 실패:', error.message);
    return res.status(500).json({ error: '랭킹을 불러오지 못했습니다.' });
  }
});

module.exports = {
  scoreRouter,
  validateScorePayload
};
