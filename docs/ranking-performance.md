# 첫 랭킹 조회 개선과 검증 (2026-10-08)

기준 main: `d8a62981c7089845d15f6fc0e4f48c9215282125` (PR #39 병합).
랭킹을 처음 열 때의 대기 시간을 줄이기 위해 인증 이후의 순차 Firestore 왕복을 줄였다.
기존 점수·세션 검증, TOP 30·중복 제거·동점·레거시 기록·KST 기간 규칙과
Firestore 접근 규칙을 유지했다. 유료 상시 인스턴스는 추가하지 않았다.

## 확인한 사실과 운영 측정의 한계

- 기존 조회: 클라이언트 Auth 준비 → ID 토큰 → CORS preflight/HTTP → 서버 토큰 검증
  → IP 요청 제한 트랜잭션 → UID 요청 제한 트랜잭션 → 캐시/공유 revision 문서 조회
  → 캐시 미적중이면 기본 쿼리 → 레거시 보충 쿼리 → 캐시 저장 → 화면 표시.
- 홈 화면은 이미 어제 1등 배너 때문에 Auth/API를 요청한다. 따라서 랭킹 버튼을 누를 때
  인증이 준비되어 있을 수 있다. 인증을 중복 미리 실행하거나 모든 사용자에게 랭킹을
  미리 조회하는 방법은 추가하지 않았다.
- 운영 공개 API는 정상 응답했다. 이 작업 환경의 프록시를 거친 REST 프로브에서
  익명 가입 12,035.7ms, 일간 첫/다음 요청 14,119.1/12,694.5ms,
  주간 첫/다음 요청 12,464.9/11,631.2ms였다. 브라우저/한국 단말의 속도와 다르며,
  기존 응답에 Server-Timing이 없어서 이 숫자로 실제 서버 병목을 확정할 수 없다.
  다음 요청도 HTTP를 실행한 측정으로, PR #39의 메모리 캐시 성능 측정이 아니다.
- Firebase CLI에 연결된 계정/배포 자격 증명이 없고 Firebase/Google Cloud 로그 커넥터도
  제공되지 않았다. Vercel 운영 로그 조회는 403으로 실패했다. 정적 프런트엔드 호스팅의
  로그만으로는 외부 Firebase Functions/Firestore 시간을 구분할 수 없다.
- 운영 배포 후 측정은 아직 없다. `minInstances: 0`의 실제 콜드 스타트 비중과
  운영 Firestore/네트워크 p50/p95는 미확정이다.

## 구현

1. IP 600회/분과 UID 120회/분 카운터를 한 Firestore 트랜잭션에서 읽는다.
   두 카운터는 여전히 공유 DB에 저장하며, UID가 거절한 요청도 기존처럼 IP allowance를
   소비한다. IP 제한에 도달하면 UID counter는 증가시키지 않는다. score-write 제한도 유지한다.
   이미 IP가 차단된 요청은 기존 1문서 대신 2문서를 읽는다. 정상 요청의 읽기·쓰기 수는 동일하다.
2. 일간/주간 기본 쿼리와 독립적인 레거시 보충 쿼리를 병렬 실행한다.
   300/1200 문서 한도와 기존 인덱스 실패 fallback, 결과 병합/정렬 규칙을 유지한다.
3. 같은 인스턴스에서 같은 기간·공유 revision의 동시 캐시 미적중 재생성을 하나로 합친다.
   모든 HTTP 요청은 먼저 공유 revision을 다시 확인한다. 점수 저장 이후 다른 revision의
   요청은 이전 작업에 합류하지 않는다. revision을 읽지 못한 요청은 공유하지 않는다.
   완료된 응답을 별도 서버 메모리 캐시에 보관하지 않아 인스턴스 간 무효화 규칙을 유지한다.
4. CORS preflight 응답에 600초 max-age를 추가한다. 실제 허용 기간은 브라우저 정책에
   따라 달라지며, 최초 preflight 자체를 제거하지는 않는다. Authorization은 유지한다.
5. 클라이언트 15초 캐시는 성공 응답 도착 시점부터 계산한다. 이전에는 15초보다 느린 첫
   요청의 결과가 도착하자마자 만료됐다. 점수 제출 전/후·KST 자정·탭 요청 순서 보호는 유지한다.
6. 계측은 응답 헤더·서버 로그·클라이언트 최대 30개 메모리 표본에만 기록한다.
   진단을 위한 Firestore 쓰기나 외부 전송은 없으며 토큰/닉네임/UID/점수 내용은 수집하지 않는다.

## 검증 결과

| 검사 | 결과 |
|---|---|
| 클라이언트/엔진 `npm test` | 63개 통과 |
| 백엔드 단위 `npm run test:backend` | 11개 통과 |
| 실제 Auth/Functions/Firestore/RTDB 에뮬레이터 | 13개 통과 |
| 390×844 모바일 랭킹 화면 | 첫 열기·재열기·일간/주간 전환·렌더링·오류 없음 확인 |
| Vite 프로덕션 빌드, `git diff --check` | 통과 |

통제 비교는 기존/수정 후의 실제 Express·랭킹 라우트를 동일한 40개 기록 fixture로 실행하고,
Firestore 각 RPC에 25ms를 주입했다. 실제 Firebase 운영 지연/청구 수치를 뜻하지 않는다.

| 통제 비교 | 기존 | 수정 후 |
|---|---:|---:|
| 첫 조회 | 227.6ms | 154.5ms |
| 클라이언트 캐시 재조회 | 0ms(표시 정밀도 이하) | 0ms(표시 정밀도 이하) |
| HTTP를 다시 보낸 서버 캐시 조회 | 130.5ms | 80.9ms |
| 첫 조회 문서 읽기/쓰기 | 64 / 3 | 64 / 3 |
| 첫 조회 요청 제한 트랜잭션 | 2 | 1 |
| 동시 미적중 3개의 점수 쿼리 | 6 | 2 |

독립적인 모바일 브라우저+에뮬레이터 확인에서는 첫 화면 표시 2105.3ms, 재열기 36.3ms였다.
첫 API의 Auth 준비/토큰 대기는 모두 0ms(홈 배너에서 이미 준비), HTTP 1654.4ms,
서버 처리 358.1ms였다. 서버 내부 토큰 검증 20.4ms, 요청 제한 261.4ms,
캐시 읽기 15.9ms, 기본/레거시 쿼리는 병렬로 각각 27.1/27.0ms였다.
**에뮬레이터 첫 요청에서는 요청 제한과 서버 외부 구간이 가장 컸지만, 운영 병목이라는
결론은 내리지 않는다.** 재열기는 Firebase 요청이 0개이며 동일 결과를 표시했다.
주간 최초 요청을 포함한 전체 랭킹 HTTP 요청은 2개였다.

에뮬레이터 회귀 검증은 새 점수 revision을 다른 사용자가 조회했을 때 반영하는지,
동시 제한 트랜잭션과 다른 limiter 인스턴스의 한도, 기존 인증/세션/레거시 순위/동점/규칙을 확인한다.
원시 결과: [verification/ranking-performance-results.json](verification/ranking-performance-results.json).

## 비용 비교

Firebase 공식 문서 확인 기준 무료 할당량은 기본 Firestore DB에 문서 읽기 50,000회/일,
쓰기 20,000회/일이다. 모든 게임·정리 작업과 공유하므로 이것이 랭킹에 전부 남아 있다는
가정은 하지 않는다. 리전별 초과 단가와 실제 사용량은 프로젝트 청구 화면에서 확인해야 한다.

| 방법 | 랭킹 읽기·쓰기 영향 | 고정 상시 비용 | 선택 |
|---|---|---|---|
| 이번 변경, minInstances 0 | 단일 요청은 동일, 같은 인스턴스의 동시 재생성은 감소 | 예약 인스턴스 추가 없음 | 적용 |
| minInstances 1, 현재 256MiB·기본 1CPU | DB 읽기·쓰기는 감소하지 않음 | 공식 문서 예시 약 US$8/월, 실제 리전/사용량 별도 | 미적용 |
| fractional CPU/gcf_gen1·256MiB, minInstances 1 | DB 읽기·쓰기는 감소하지 않음, 동시 처리 비활성화 | 공식 문서 예시 약 US$3/월 | 미적용 |

정상 서버 캐시 적중 1회는 여전히 요청 제한 2문서+cache/revision 2문서 = 최소 4읽기와
제한 카운터 2쓰기를 사용한다. 다른 사용량이 전혀 없다는 산술 가정에서 읽기 약 12,500회,
쓰기 약 10,000회의 이런 조회가 하루 무료 한도에 해당한다. 트랜잭션 재시도·TTL 삭제·다른
게임/정리 작업·일부 인덱스 읽기 요금은 이 산술에 포함하지 않는다.
일간/주간 캐시 미적중은 기본 최대 300+레거시 최대 1200+위 4문서 = 최대 1504 문서 읽기,
인덱스 fallback 경로는 최대 2404 문서 읽기를 사용할 수 있다. 중복 문서도 각 쿼리에서 읽으면
각각 계산된다. 호환성 확인 없이 레거시 보충을 삭제해 읽기를 줄이지 않았다.

## 배포 후 진단과 재현

빌드/테스트만으로 Firebase Functions는 자동 배포되지 않는다. 로그인된 환경에서 기존
`configure:firebase`/`deploy:firebase` 절차로 확인된 `sequencepang` 프로젝트의 Functions를
배포하고 프런트엔드를 반영해야 한다. 이 작업에서는 운영 배포를 실행하지 못했다.
새 컬렉션, 데이터 마이그레이션, 보안 규칙 완화나 유료 minInstances 설정은 필요 없다.

```sh
npm test
npm run test:backend
npm run test:emulators
npm run test:ranking-browser
npm run build
git diff --check
# 비교하려는 기존 checkout 경로를 제공한다 (해당 checkout에 dependencies 필요).
node scripts/benchmark-ranking.cjs /path/to/baseline-checkout
```

제한된 실행 환경에서는 저장소의 기존 TCP 에뮬레이터 adapter를 사용했다:
`SEQUENCEPANG_EMULATOR_TCP=true`. 별도 Chromium 실행 파일은
`SEQUENCEPANG_BROWSER_EXECUTABLE`로 지정할 수 있다.

운영에서 DevTools Performance의 `sequencepang:ranking` User Timing detail을 확인한다.
`kind: api`는 authReadyMs/tokenMs/httpMs/decodeMs/serverTiming,
`client-hit`는 서버 요청 없는 재조회, `client-shared`는 진행 중 요청 합류를 나타낸다.
서버의 `ranking_timing` 로그에는 다음 구간이 기록된다:

| 구간 | 해석 |
|---|---|
| auth_verify | 서버 ID 토큰 검증 |
| firestore_rate_limit | 공유 IP·UID 제한 트랜잭션 |
| firestore_cache_read | revision/cache 문서 병렬 조회 |
| firestore_scores / firestore_legacy | 기본(인덱스 실패 시 fallback 포함) / 보충 조회 |
| firestore_cache_write | 재생성한 캐시 저장 |
| leaderboard_rebuild_wait | 재생성 전체 대기, shared-miss이면 다른 요청의 작업 대기 |
| server_total | 앱 middleware 진입부터 JSON 응답 시작까지 |
| instance_first_request / module_load | 프로세스 첫 HTTP 요청 표식 / JS 모듈 로딩 시간 |

기본/레거시 조회는 겹치고 rebuild_wait도 이 작업들을 포함하므로 시간을 합산하면 안 된다.
HTTP 시간에서 server_total을 뺀 나머지는 네트워크뿐 아니라 preflight·플랫폼 대기·시작 시간을
포함한다. instance_first_request는 OPTIONS/홈 배너에서 먼저 소비될 수 있으며,
**콜드 스타트 시간 자체가 아니다.** 콜드 스타트를 확정하려면 Cloud Run의 시작/요청 로그와
시각을 대조해야 한다. 운영에서 첫/재조회와 캐시 miss/hit, 새 기기/기존 기기를 구분해
p50/p95를 수집한 후, 필요할 때만 유료 상시 인스턴스를 검토한다.

공식 근거:
- https://firebase.google.com/docs/functions/manage-functions
- https://firebase.google.com/docs/firestore/pricing
- https://firebase.google.com/docs/firestore/quotas
- https://cloud.google.com/firestore/pricing
