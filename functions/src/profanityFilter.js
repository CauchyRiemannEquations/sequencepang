// 닉네임 비속어 필터
// 단어 목록 출처: https://github.com/Tanat05/korean-profanity-resources (slang.csv)
const PROFANITY_WORDS = require('./data/profanityWords.json');

function normalizeForFilter(value, stripDigits = false) {
  const pattern = stripDigits ? /[^a-z가-힣]/g : /[^a-z0-9가-힣]/g;
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(pattern, '');
}

// 공백·특수문자·숫자 끼워넣기 우회까지 잡기 위해 두 가지 정규화로 검사
function isProfaneNickname(nickname) {
  const compact = normalizeForFilter(nickname);
  if (!compact) return false;
  const lettersOnly = normalizeForFilter(nickname, true);

  return PROFANITY_WORDS.some(word =>
    compact.includes(word) || (lettersOnly !== compact && lettersOnly.includes(word))
  );
}

module.exports = {
  isProfaneNickname
};
