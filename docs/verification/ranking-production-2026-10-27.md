# 랭킹 운영 배포·검증 — 2026-10-27

PR #40의 백엔드는 실제로 미배포였다. 기존 최적화를 배포하고 레거시 보충 쿼리의 반환 필드를 줄였다.
인증 준비 후 서버 요청과 15초 이내 재열기는 정상 검증했다. **신규 컨텍스트에서 첫 DB 요청까지
겹치는 조회의 뚜렷한 개선은 확인하지 못했다.** 코드 변경, 테스트 통과, 운영 배포와 성능 결과를 구분한다.

## 배포 여부와 범위

- 최신 main 기준 `4a3ad6b`. 새 작업 디렉터리에 복제했으며 기존 변경은 없었다. 적용되는 AGENTS.md는 없었다.
- Firebase CLI의 기존 로그인으로 프로젝트 권한을 확인했다. 비밀키 추가 발급 없이 Cloud Functions API와
  배포된 소스 ZIP을 조회했다. 이전 `api-00002-joq`의 updateTime은 `2026-10-05T23:38:45Z`로,
  PR #40의 10월 8일 병합보다 이르다. ZIP과 main의 차이는 PR #40의 백엔드 6개 파일이며,
  functions package.json/package-lock.json은 SHA-256까지 같았다. 헤더 부재만으로 판단하지 않았다.
- 운영 프런트 `/assets/index-CgMjhs8d.js`에는 `sequencepang:ranking`과 `Server-Timing` 계측이 있었다.
  프런트 변경이나 Vercel 운영 재배포는 하지 않았다.
- Functions는 `asia-southeast1`, Firestore 기본 DB는 `asia-northeast3`였다. 리전 차이로 인한 왕복이
  있는 것은 확인했지만, 순수한 리전 지연과 DB 처리 시간을 별도 실험 없이 동일시하지 않는다.
- 기존 `deploy:firebase`는 모든 함수·Firestore 규칙·인덱스·RTDB 규칙을 포함한다. 사용하지 않았다.
  실제 실행은 다음과 같이 api만 선택했다. CLI 14.27.0의 codebase:function 필터 해석도 확인했다.

```sh
node node_modules/firebase-tools/lib/bin/firebase.js deploy --project sequencepang --only functions:sequencepang:api --non-interactive
```

| 단계 | revision | updateTime (UTC) | 결과 |
|---|---|---|---|
| 기존 | api-00002-joq | 2026-10-05 23:38:45 | PR #40 없음 |
| PR #40 적용 | api-00003-vat | 2026-10-27 01:22:54 | 배포 성공 |
| REST 전송 실험 | api-00004-deg | 2026-10-27 01:26:53 | 배포·검증 후 채택하지 않음 |
| 최종: 기존 gRPC + 필드 projection | api-00005-jur | 2026-10-27 01:31:45 | ACTIVE, 최신 revision에 전체 트래픽 |

최종 Node.js 22, 256MiB, CPU 1, maxInstances 5, minInstances 0을 유지했다.
최종 배포 ZIP도 다시 내려받아 `functions/src`와 파일 내용이 모두 일치하는지 확인했다.
cleanup 소스 generation `1791243526594311`과 roomPresence `1791242904599548` 및 두 함수의 해시는
전후 동일했다. 규칙·인덱스·리전·다른 함수는 배포하지 않았다.

## 코드와 의미 보존

1. PR #40의 통합 IP/UID 제한 트랜잭션, 기본/레거시 병렬 쿼리, revision별 동시 재생성 합치기,
   Server-Timing과 CORS preflight 캐시를 운영에 적용했다.
2. `loadPeriodDocs`의 레거시 보충 쿼리에 필드 projection을 추가했다. nickname, score, maxCombo,
   mode, playerId, createdAt, rankingSeason, rankingDay, rankingWeek를 가져온다.
   상위 1,200건 범위와 score 정렬, 문서 ID 병합, 기간 판정·TOP 30·중복 제거·동점 규칙은 동일하다.
   운영 상위 3문서의 REST JSON 필드 표현 크기는 전체 737/737/842 bytes에서 선택 필드만
   406/405/380 bytes였다. 이 소표본은 전송량 감소의 예시이며 전체 속도 개선율이 아니다.
   Firestore 문서 읽기 과금 횟수는 줄지 않는다.
3. 80개 fixture로 projection 전후 기간·동점·playerId/닉네임 중복 제거·TOP 30 결과를 비교하는 테스트를 추가했다.
   재현 benchmark는 projection을 처리하도록 수정하고 Windows ESM 경로를 file URL로 바꿨다.
4. Admin SDK `preferRest: true`도 실험했으나 첫 화면 5.462→5.614초(각 1회)와 미적중 응답에서
   이점이 확인되지 않아 원래 전송으로 되돌렸다. 최종 소스에는 이 변경이 없다.

클라이언트 15초, 서버 30초 TTL을 늘리지 않았다. 점수 저장 시 공유 revision 증가와 클라이언트
제출 전후 무효화를 유지한다. 테스트 점수의 운영 제출, 운영 데이터 삭제, 보안 규칙 완화는 없었다.
상시 인스턴스와 리전 이전은 적용하지 않았다.

## 운영 측정

동일 Windows 호스트의 headless Chromium, 390×844 모바일 viewport, 실제 Vercel 프런트와 Firebase API를 사용했다.
한국 일반 사용자 단말을 대표하지 않으며 네트워크 경로·실기기 성능을 통제하지 않았다.
각 비교 실행은 새 브라우저 컨텍스트에서 첫 조회 → 즉시 재열기 → 16초/16초/31초 대기 후 조회 3회 → 주간 조회 순서다.
새 컨텍스트는 정상 익명 인증을 수행하며 게임 세션 발급이나 점수 제출은 하지 않는다.
화면 시간은 페이지 안에서 버튼 클릭부터 로딩 문구가 결과로 바뀔 때까지다.

| 화면 표시 조건 | 배포 전 | PR #40만 | 최종 projection |
|---|---:|---:|---:|
| 새 컨텍스트 + 해당 인스턴스 첫 DB 경로, 각 1회 | 5,447.7ms | 5,461.8ms | 5,283.1ms |
| 인증 준비, 클라이언트 캐시 만료, 각 3회 | 1,347.6 / 1,347.2 / 1,415.6ms | 703.1 / 1,305.1 / 1,115.1ms | 441.6 / 1,247.6 / 1,292.1ms |
| 15초 이내 재열기, 각 1회 | 9.7ms | 10.1ms | 4.1ms |
| 재열기 HTTP 요청 | 0 | 0 | 0 |

배포 전 응답에는 구간 계측이 없어 서버 캐시 hit/miss를 확정하지 않는다.
PR #40 및 최종의 캐시 만료 조회 3회는 Server-Timing으로 각각 `firestore-hit`, `miss`, `miss`를 확인했다.
서버 캐시 미적중은 여전히 약 1.2초 수준이다. projection 단독으로 뚜렷한 응답 시간 개선을 입증한 것은 아니다.
첫 조회는 인증과 DB 준비 상태별로 다르며 이 숫자를 하나의 평균으로 합치지 않는다.
작은 표본에서 p95나 개선율을 산출하지 않았다.

최종 배포의 재현 스크립트 자체도 같은 운영 환경에서 한 번 더 실행했다. 이미 DB 연결이 준비된
같은 revision에서 새 브라우저 컨텍스트 첫 화면은 2,785.6ms(인증 준비 1,471.4ms,
HTTP 1,213.9ms, server_total 870.8ms)였다. 이후 캐시 만료 3회는 493.6ms(hit),
1,021.3/1,236.1ms(miss), 즉시 재열기는 12.2ms·HTTP 0회였다.
이 실행은 DB 준비 상태가 달라 위의 배포 전 첫 조회 5,447.7ms와 직접 개선율로 비교하지 않는다.
최종 두 실행을 합쳐 인증 준비 상태 hit 2회는 441.6~493.6ms, miss 4회는 1,021.3~1,292.1ms였다.

최종 첫 요청의 클라이언트 인증 준비 1,401.1ms, 토큰 0.3ms, HTTP 3,733.2ms, JSON 디코딩 0.2ms였다.
인증 준비가 끝난 3회에서는 authReady 0.1~0.2ms, token 0~0.1ms, decode 0.3~0.5ms였다.

| 최종 서버 구간 | 첫 DB 경로 + miss | 준비 완료 + hit | 준비 완료 + miss (2회) |
|---|---:|---:|---:|
| 토큰 검증 | 55.2ms | 1.2ms | 0.9~1.1ms |
| IP/UID 요청 제한 트랜잭션 | 2,468.0ms | 205.9ms | 193.8~197.2ms |
| 공유 revision/cache 조회 | 108.1ms | 90.6ms | 96.1~98.4ms |
| 기본 쿼리 | 97.9ms | 실행 없음 | 88.8~92.2ms |
| 레거시 쿼리 | 581.7ms | 실행 없음 | 662.5~751.5ms |
| 캐시 저장 | 103.3ms | 실행 없음 | 100.2~141.8ms |
| server_total | 3,330.1ms | 299.0ms | 1,110.1~1,150.7ms |

기본/레거시 쿼리는 겹치므로 합산하지 않는다. 요청 제한 구간에는 최초 SDK/인증/연결 준비 및
트랜잭션 대기·재시도가 포함될 수 있어 이를 순수 DB 트랜잭션 실행이나 콜드 스타트 시간으로 단정하지 않는다.
홈 화면 yesterday-top과 ranking이 동시에 같은 제한 카운터를 사용할 수 있다.
Cloud Run 로그에서 최종 인스턴스는 01:31:39 UTC에 DEPLOYMENT_ROLLOUT로 시작하고
01:31:44에 startup probe를 통과했다. 첫 랭킹 OPTIONS는 01:32:19였다.
따라서 이 표본은 scale-from-zero 콜드 스타트 전체를 재는 표본이 아니다.

서버 캐시 hit에도 제한 카운터 2문서 + revision/cache 2문서 읽기와 제한 카운터 2쓰기가 남는다.
캐시 hit에서 DB 왕복이 사라졌다고 보고하지 않는다. 일간 기본 0건인데도 레거시는 1,200건을 반환했다.
호환성을 유지하는 범위에서 레거시 조회의 근본적인 읽기 수 절감은 남은 과제다.

운영 preflight는 전후 모두 204이며 최종 `Access-Control-Max-Age: 600`과
`Access-Control-Expose-Headers: Server-Timing`을 확인했다. 첫 preflight는 여전히 필요하다.
별도 PowerShell preflight 표본은 배포 전 745.4/291.2/201.0ms, 배포 후 560.8ms였다.
연결 준비가 다른 독립 HTTP 측정이므로 브라우저 개선율로 사용하지 않는다.
CDP 기록은 모든 cross-origin preflight를 포착하지 못했다. httpMs-server_total의 나머지에는
preflight, 네트워크와 플랫폼 대기가 섞이며 각 항목을 정밀 분해했다고 주장하지 않는다.

## 검증과 재현

- 클라이언트/엔진 83, 최종 백엔드 단위 12, Auth/Functions/Firestore/RTDB 에뮬레이터 13개 통과.
- 최종 projection으로 모바일 랭킹 에뮬레이터 검사 통과: 일간/주간 전환, 재열기 HTTP 0회, 동일 결과.
- 프로덕션 빌드와 git diff --check 통과. 로컬 Node.js 24.15.0, 에뮬레이터도 호스트 Node 24를 사용했으며
  실제 배포 런타임은 Node 22다. 실제 배포 응답 검증으로 런타임 차이를 보완했지만 완전한 대체는 아니다.
- 운영 미인증/잘못된 토큰 401, 허용하지 않은 Origin 403 확인. 정상 랭킹 요청은 모두 200.
- 측정 시 일간 0건·주간 2명이며 배포 전후 payload 해시가 동일하다. 화면에도 같은 기록을 표시했다.
  30명·동점·중복·KST 경계와 점수 제출 후 다른 사용자 갱신은 운영 점수를 만들지 않고 에뮬레이터에서 검증했다.
- 운영 재현 도구: `npm run test:ranking-production -- <label>` (약 1~2분).
  결과와 스크린샷은 `artifacts/production-ranking/`에 생성된다. 실제 운영 읽기·정상 익명 인증을 발생시키므로
  무제한 반복/부하 테스트 용도로 사용하지 않는다.
- 식별 정보 없는 측정 요약: [ranking-production-2026-10-27.json](ranking-production-2026-10-27.json).

남은 문제는 신규 인증 준비, 첫 DB 요청 준비 비용, cross-region 왕복과 레거시 보충 조회다.
고정 비용이나 리전 이전 없이 첫 조회 전체가 해결됐다고 결론 내릴 근거는 없다.

공식 참고: [개별 함수 배포](https://firebase.google.com/docs/functions/manage-functions),
[Admin SDK 전송 설정](https://firebase.google.com/docs/reference/admin/node/firebase-admin.firestore.firestoresettings).
