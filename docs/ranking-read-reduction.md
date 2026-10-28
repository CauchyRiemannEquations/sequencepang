# 랭킹 반복 읽기 절감 후보 — 2026-10-29

## 상태와 확인 범위

- 기준: `CauchyRiemannEquations/sequencepang` main `ddcfe53a4a95f4d47cfdd1cd2eb3cd83d675884a`.
  GitHub read-only connector로 최신 트리를 읽고, 로컬 모든 추적 파일의 Git blob SHA를 대조했다.
- 이 문서는 **미배포 코드 후보**의 변경과 로컬 검증을 설명한다. 운영 Firebase 사용량/요금/현재 리비전은 직접 조회하지 않았다.
- 저장소의 [2026-10-27 운영 보고서](verification/ranking-production-2026-10-27.md)는 당시 일간 기본 0건에도 레거시 1,200건을 읽었고, 레거시 조회에 약 0.6~0.75초가 걸렸다고 기록한다. 이는 과거 보고서이지 이번 실시간 측정이 아니다.
- 기존 client 15초 캐시, server 30초 캐시가 있어도, 만료·다른 기간·점수 제출 후 순위 계산에서 전체 호환성 조회를 되풀이했다. 필드 projection은 전송량만 줄였고 문서 읽기 수는 줄이지 않았다.

## 변경

1. 공유 `ranking_state/current.revision`을 **모든 leaderboard API 요청에서 계속 확인**한다. 새 점수는 기존 점수 저장 트랜잭션에서 revision을 증가시키므로 다른 인스턴스도 기존 응답을 유효한 캐시로 취급하지 않는다.
2. revision이 같은 응답은 최대 5분의 정렬된 구간까지 재사용한다. 30초마다 변경 없는 데이터를 재생성하지 않는다. 관리자 직접 수정처럼 revision을 갱신하지 않은 변경도 무기한 남지 않도록 5분을 안전 상한으로 둔다.
3. 1,200건 전역 보충 스냅샷은 인스턴스 내에서 revision·5분 구간별로 공유한다. 오늘/주간/어제 조회가 같은 데이터를 중복 스캔하지 않는다. 인덱스 실패 때 fallback과 supplement도 같은 조회를 공유한다.
4. 점수 저장 뒤 이미 계산한 오늘 순위와 TOP30을 함께 반환한다. 서버 캐시에도 게시하고 클라이언트 캐시를 채워, 게임 종료 직후 같은 랭킹을 다시 GET하지 않는다. 이전 백엔드나 순위 계산 실패는 기존 GET 경로로 복구한다.
5. 서버 캐시 게시 트랜잭션은 더 최신 revision/구간을 오래된 요청이 덮어쓰지 못하게 한다. 게시 시 읽기 1회/트랜잭션 시도 비용을 추가하지만, 중복 재생성을 막는다. read-count 비교에도 이 비용을 포함한다.
6. 어제 1등은 작은 공개 결과만 Firestore에 재사용한다. 이전처럼 콜드 인스턴스마다 1,200건을 다시 읽지 않는다. 자정 직전 요청의 늦은 커밋과 관리자 수정도 반영하도록 메모리·영속 캐시 모두 같은 5분 상한을 적용한다.
7. 최근 같은 날짜의 랭킹은 먼저 화면에 표시하고 만료 시 요청 한 번으로 갱신한다. 갱신 중/실패는 한국어로 표시한다. 15초 클라이언트 TTL은 늘리지 않고 polling/사전 자동 조회도 추가하지 않는다.
8. `ranking_timing` 로그에 SDK 읽기 호출, 반환 문서 수, 빈 쿼리 최소 읽기 단위, 트랜잭션 시도 수를 추가한다. nickname/playerId/UID/IP/점수/토큰은 이 로그에 기록하지 않고 별도 Firestore 분석 문서도 쓰지 않는다.

## 보존·호환성

- TOP30, indexed 300 + global 1,200 후보 범위, playerId·닉네임 2단계 중복 제거, 동점 순서, 레거시 필드 없는 기록, 명시적 일/주 메타데이터 우선순위를 유지한다. 단순히 legacy 조회를 삭제하거나 limit(30)으로 줄이지 않았다.
- 점수 데이터 삭제/재작성/이관, 새 인덱스·보안 규칙 변경, 세션 검증 완화, rate limit 완화, 리전 변경, minInstances 증가는 없다.
- `expiresAt`과 `freshUntil`을 같은 시각으로 저장한다. 기존 코드/롤백 코드가 `freshUntil`을 몰라도 장기 보관 TTL을 freshness로 오해하지 않는다.
- freshness는 쿼리 완료가 아니라 시작한 구간을 기준으로 한다. 경계를 넘어 끝난 요청이 오래된 데이터를 다시 5분 연장하거나, 다음 구간의 요청과 합쳐지지 않는다.
- 지원되는 운영 scores 작성 경로는 `commitSessionScore`이며 revision을 같은 트랜잭션에서 증가시킨다. 향후 관리자 삭제/수정/import는 같은 원칙을 따라야 즉시 반영된다. 이를 누락하면 안전 갱신 경계까지 최대 약 5분 지연될 수 있다.
- 한 요청이 revision을 읽은 **후** 새 점수가 저장되면 진행 중 응답은 그 이전 스냅샷일 수 있다. 이를 모든 진행 중 요청의 선형화 보장으로 설명하지 않는다. 그 다음 새 API 요청은 공유 revision을 다시 검사한다. 브라우저의 기존 15초 캐시 창은 별도로 유지된다.

## 재현 가능한 읽기 비교

`npm run test:ranking-reads -- <수정하지 않은 기준 체크아웃>`

실제 Express middleware/점수 검증/라우트와 결정적 in-memory Firestore를 사용한다. 네트워크 포트·운영 Firebase·계정 인증을 사용하지 않는다. 1,300개 과거 기록 + 5개 현재 기록 fixture이며 비교 전후 랭킹 JSON이 동일함을 assert한다. 문서 읽기 단위는 요청 제한·캐시 게시·세션 읽기와 빈 쿼리 최소값을 포함한다.

| 합성 시나리오 | 기준 읽기 단위 | 후보 읽기 단위 | legacy 스캔 기준→후보 | HTTP 기준→후보 |
|---|---:|---:|---:|---:|
| 새 점수 없이 31초 간격 조회 10회 | 12,090 | 1,246 | 10→1 | 10→10 |
| 게임 8회: 세션 발급+점수 등록+랭킹 표시 | 19,440 | 9,748 | 16→8 | 24→16 |
| 오늘→주간 전환 | 2,418 | 1,220 | 2→1 | 2→2 |

첫 시나리오는 고정 5분 경계 직후 시작한다. 실제 요청 분포·인스턴스 수·캐시 경계·쓰기 빈도에 따라 이득이 달라진다. **운영 비용 절감률 또는 지연 개선률이 아니다.** index-entry 과금, SDK 내부 재시도, 다른 기능의 읽기는 이 모델에 포함하지 않는다. 실제 트랜잭션 콜백 재시도는 추가 계측에서 관측한다.

## 여전히 남는 비용/지연

- 새 revision의 첫 계산은 호환성을 위해 여전히 1,200건을 읽는다. 지속적으로 새 점수가 생기면 5분 응답 캐시 효과보다 제출 후 중복 제거의 효과가 중요하다.
- 인스턴스 사이의 메모리 스냅샷은 공유되지 않는다. 동시에 시작한 여러 인스턴스의 첫 miss까지 전역 lock으로 합친 것은 아니다.
- cache hit에도 기존 보안용 IP/UID 제한 2문서 + revision/cache 2문서 읽기와 제한 카운터 쓰기가 남는다.
- 최초 익명 인증, scale-from-zero/첫 SDK 연결, 네트워크와 Functions/Firestore 리전 차이는 이 패치로 제거하지 않는다. 과거 보고서의 함수 `asia-southeast1` / Firestore `asia-northeast3`는 이번에 실시간 재검증하지 않았다.
- 추가 절감은 기존 기록의 필드/순위 의미를 검증한 뒤 별도 승인된 migration 또는 쓰기 시 유지하는 compact ranking index가 필요하다. 그 작업은 이번 패치에 포함하지 않는다.

## 운영 반영 시 최소 범위 (승인 후)

기존 Firebase 프로젝트 `sequencepang`, 함수 codebase `sequencepang`, 함수 이름 `api`이다. 인증된 작업 환경에서 기존 공개 배포 설정을 확인한 뒤 **api만** 배포한다.

```sh
npm ci
npm --prefix functions ci
npm test
npm run test:backend
npm run test:emulators
npm run build
node node_modules/firebase-tools/lib/bin/firebase.js deploy --project sequencepang --only functions:sequencepang:api --non-interactive
```

`npm run deploy:firebase`는 다른 함수·Firestore 규칙/인덱스·RTDB 규칙까지 포함하므로 이 수정의 최소 배포 명령이 아니다. api 배포와 별도로 프런트 반영이 있어야 POST 결과 재사용과 즉시 표시가 적용된다. SW v40을 준비했지만 배포한 것은 아니다. 리전/다른 함수/보안 설정은 바꾸지 않는다.

배포 후에는 배포 revision과 소스 확인, 정상 랭킹/성공한 실제 점수 제출/다른 사용자 갱신을 적은 요청으로 확인한다. 테스트를 위해 운영 점수를 만들거나 반복 부하 테스트하지 않는다. 새/기존 방문자의 첫 화면, 서버 hit/miss, POST 이후 중복 GET 유무를 분리하고 동일 관찰 기간의 Firebase 문서 읽기와 트래픽을 비교한다. 사용량 화면과 청구 내역의 측정 범위 차이도 명시한다.

## 근거 자료

- [Firestore 가격/최소 읽기·트랜잭션](https://firebase.google.com/docs/firestore/pricing)
- [Firestore 사용량 모니터링의 집계 범위](https://firebase.google.com/docs/firestore/monitor-usage)
- [트랜잭션 재시도](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Functions 인스턴스·전역 변수 유의사항](https://firebase.google.com/docs/functions/tips)

## 이번 최종 검증 결과

- `npm test`: **101/101 통과**.
- `npm run test:backend`: **31/31 통과** (기존 12 + 읽기 계측 1 + 읽기 절감/경합 회귀 18).
- Auth / Functions / Firestore / RTDB 에뮬레이터: **13/13 통과**. 정상 인증·교차 사용자 갱신·단일 세션 중복 제출 차단·legacy TOP30·동점/중복·presence/cleanup 회귀를 포함한다.
- 제한된 실행 환경에서는 SDK의 Unix socket을 쓸 수 없어 저장소에 원래 있던 `SEQUENCEPANG_EMULATOR_TCP=true` 어댑터와 `/tmp` emulator cache를 사용했다. 프로덕션 코드/규칙을 우회한 것이 아니라 로컬 테스트 서버 통신만 TCP로 바꿨다. Node 24.19.0 / Java 21이며 운영 선언 Node 22와 차이가 있다.
- `npm run build`, JavaScript 구문 검사, `git diff --check`, 세 합성 비교 시나리오 통과.
- 독립 검토에서 추가로 41개 집중 검사를 실행하고, 지연된 제출 전 GET/자정 GET의 실제 cache+UI DOM 재현을 다시 확인했다. 검토 중 발견된 경합·만료·롤백 호환 문제는 수정하고 회귀 검사를 추가했다.
- 실제 Chromium 테스트 6개는 준비했지만 **이번 환경에서 실행되지 못했다**. 브라우저 시작의 socket EPERM 및 실행기 escalation 인프라 오류로 차단되었다. Node DOM 테스트는 통과했으나 실제 브라우저/시각 검증의 대체로 표기하지 않는다.
- 운영 배포·실사용 요금/지연 검증·실제 브라우저 검증은 미완료다. 기존 계정 로그인 없는 이 cloud worker에서는 Firebase CLI가 `No authorized accounts`를 반환했다. 새 자격 증명이나 로그인은 만들지 않았다.
