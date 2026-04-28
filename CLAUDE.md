# 학원 출석체크 서비스 — Claude Code 컨텍스트

## 서비스 개요
학원 학생이 태블릿에서 부모님 뒷자리 4자리를 입력하면 등원/하원 출석이 처리되고,
부모님께 카카오 알림톡이 자동 발송되는 서비스.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4 |
| 백엔드 / DB | Supabase (PostgreSQL + RLS) |
| Supabase 클라이언트 | `@supabase/ssr` — server/browser 분리 |
| 관리자 인증 | bcryptjs(비밀번호 해시) + jose(JWT, Edge·Node 호환) |
| 배포 | Vercel |
| 알림 발송 | 솔라피(Solapi) — 카카오 알림톡 + SMS 자동 대체 발송 |
| 재시도 스케줄러 | Supabase pg_cron + `/api/notify` |
| 버전 관리 | GitHub |

---

## 라우트 구조

```
src/app
  /tablet                      ← 학생용 출석 화면 (키오스크, 가로 고정, 'use client')
  /admin                       ← 원장용 관리자 페이지 (반응형, 'use client')
    /login                     ← 관리자 로그인 페이지
  /api
    /attendance                ← 출석 처리 (POST)
    /notify                    ← 솔라피 알림톡 발송 (POST)
    /auth                      ← 관리자 로그인(POST) / 로그아웃(DELETE)
    /admin                     ← 관리자 전용 (모두 JWT 쿠키 검증)
      /dashboard               ← 오늘 출결 요약
      /students [id]           ← 학생 CRUD
      /attendance [id]         ← 출석 기록 조회/수정
      /absences                ← 결석 처리/조회 (학생별 클래스 요일 합집합 기준)
      /absentees               ← 미출석 학생 조회 (오늘 수업 있는 학생만)
      /classes [id]            ← 클래스 CRUD + 학생 배정
      /notifications/failed    ← 알림 실패 내역

src/lib
  /supabase  client.ts         ← createBrowserClient (브라우저)
             server.ts         ← createServerClient + cookies (SSR/라우트)
  /auth      jwt.ts            ← signAdminToken / verifyAdminToken (jose, HS256)
             admin.ts          ← getAdminClaims (쿠키 → claims 헬퍼)
  /types     database.ts       ← Supabase 생성 타입

src/middleware.ts              ← /admin/* 경로 JWT 가드 (Edge Runtime)
```

---

## 핵심 비즈니스 로직

### 출석 체크 흐름 (`POST /api/attendance`)
1. 본문 파싱 + 형식 검증 (`phone_last4` 4자리, `type` enum)
2. `academy_id` 결정 — 우선순위: `NEXT_PUBLIC_ACADEMY_ID` → `body.academy_id` → academies 첫 row
3. `student_parents.phone_last4`로 후보 학생 ID 수집 (Set으로 중복 제거)
4. `students`에서 `academy_id` + `is_active=true`로 필터링
   - 0명 → `NOT_FOUND` / 2명 이상 → `MULTIPLE`(이름 목록 반환) / 1명 → 다음 단계
5. 쿨타임 체크 (`attendance_logs`에 동일 학생·동일 type 기록이 5분 이내 존재 시 `COOLDOWN`)
6. `attendance_logs`에 기록 (checked_at은 DB default(now())에 위임)
7. 학생의 전체 학부모 조회 → `notification_logs`에 학부모 수만큼 `pending` 적재 → `/api/notify` fire-and-forget 호출
8. 성공 응답 (학생명, type, checked_at)

> 응답 정책: 비즈니스 분기는 모두 200 + `error` 필드, 본문 검증 실패만 400, DB 오류만 500.

### 쿨타임 규칙
- 동일 학생 + 동일 타입(등원→등원 / 하원→하원) 기준 5분 이내 재입력 차단
- 등원 후 하원은 쿨타임 없이 허용
- 비교는 서버 시계 기준 (클라이언트 시계 위변조 방지)

### 클래스(반) / 출석 기대 요일
- 클래스: `(name, weekdays[])` — 매주 반복되는 수업 요일을 0(일)~6(토) 정수 배열로 보관
- 학생 ↔ 클래스: 다대다 (`student_classes` 조인 테이블)
- **출석체크 API는 클래스 요일을 검사하지 않음** — 보강 수업 가능 (수업 없는 날도 등원/하원·알림 정상 처리)
- **결석 판정**: 학생이 속한 클래스의 weekdays 합집합에 해당하는 날짜만 결석 후보로 본다
  - 클래스 미배정 학생은 결석 집계에서 제외 (분모가 0이라 결석 자체가 정의되지 않음)
- **대시보드/미등원**: 오늘 KST 요일에 수업이 있는 활성 학생만 분모로 잡는다 (`today_expected_count`)

### 알림톡 재시도 (Exponential Backoff)
- 1차 실패 → 1분 후 재시도
- 2차 실패 → 5분 후 재시도
- 3차 실패 → 15분 후 재시도
- 3회 모두 실패 시 → `notification_logs.status='failed'` → 관리자 페이지 "전송실패"에 표시
- 재시도는 pg_cron이 `next_retry_at <= now()` 행을 픽업해 `/api/notify` 호출

### 관리자 인증 흐름
1. `/admin/login` 페이지에서 비밀번호 입력 → `POST /api/auth`
2. `academies` 첫 row의 `admin_password_hash`와 `bcrypt.compare`
3. 일치 시 `signAdminToken({ academy_id })`로 HS256 JWT 발급 (7일)
4. httpOnly + secure(prod) + sameSite=lax 쿠키(`admin_token`)에 저장
5. `middleware.ts`가 모든 `/admin/*` 진입 시 쿠키 검증 → 실패 시 `/admin/login`으로 리다이렉트
6. `/api/admin/*` 라우트는 미들웨어 매처 밖이므로 핸들러 안에서 `getAdminClaims()`로 직접 검증
7. 로그아웃: `DELETE /api/auth` → 동일 옵션의 빈 쿠키(maxAge=0)로 덮어 삭제

---

## DB 스키마 요약

```
academies          학원 정보 + admin_password_hash (bcrypt)
students           학생 목록 (is_active로 소프트 삭제)
student_parents    학부모 연락처 (1학생 N명, phone_last4 인덱스)
classes            반(클래스) — name + weekdays smallint[] (0=일~6=토)
student_classes    학생 ↔ 클래스 다대다 조인 (PK = student_id+class_id)
attendance_logs    등원/하원/결석 기록 (type: checkin | checkout | absent, memo 컬럼 포함)
notification_logs  알림톡 발송 상태 + 재시도 관리 (attempt_count 최대 3, next_retry_at)
```

전체 스키마 SQL → SCHEMA.md 참고

---

## 알림톡 템플릿

```
등원: [#{학원명}] #{학생명} 학생이 #{시각}에 등원했습니다.
하원: [#{학원명}] #{학생명} 학생이 #{시각}에 하원했습니다.
```

- 시각 포맷: `오전/오후 H:MM` (KST, `Intl.DateTimeFormat` formatToParts로 조립)
- 알림톡 실패 시 동일 본문으로 SMS 자동 대체 (`disableSms: false`)
- 솔라피 변수 매핑 → ALIMTALK_TEMPLATE.md 참고

---

## 환경변수 (.env.local)

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_ACADEMY_ID         # 단일 학원 운영 시 출석 API에서 사용

# 관리자 JWT
JWT_SECRET                     # HS256 서명 키 (충분히 긴 무작위 문자열)

# 솔라피 — 카카오 알림톡 + SMS 폴백 발송
SOLAPI_API_KEY
SOLAPI_API_SECRET
SOLAPI_SENDER                  # 발신번호
SOLAPI_PFID                    # 카카오 발신 프로필 ID
SOLAPI_TEMPLATE_ID_CHECKIN
SOLAPI_TEMPLATE_ID_CHECKOUT
```

---

## 태블릿 UI 요구사항
- 가로 모드 고정 (1280×800 기준)
- 브라우저 풀스크린 권장
- 버튼 최소 120px 높이 (터치 친화적)
- 폰트 최소 24px
- 등원 = 따뜻한 색 계열 / 하원 = 차가운 색 계열
- 화면당 행동 1개만
- 키오스크 화면 구성: Main → Keypad → (Select) → Done / NotFound / Cooldown

## 관리자 페이지 요구사항
- 모바일 / PC 반응형
- 메뉴: 대시보드 / 출결기록 / 학생관리 / 클래스관리 / 결석관리 / 전송실패
- UI 라이브러리 미도입 — 인라인 SVG 아이콘 + 자체 스타일링으로 구성
- 관리자 인증: 단순 비밀번호 (bcrypt 해시 + JWT 쿠키, Supabase Auth 미사용)

---

## 참고 문서
- `PRD.md` — 전체 기능 요구사항 + 엣지케이스 (문서 헤더에 현재 버전 표기)
- `SCHEMA.md` — Supabase 스키마 SQL + 핵심 쿼리
- `ALIMTALK_TEMPLATE.md` — 솔라피 알림톡 템플릿 + 연동 가이드

---

## 코드 작성 규칙
- 언어: TypeScript (strict mode)
- 스타일: Tailwind CSS only (별도 CSS 파일 금지)
- 컴포넌트: Server Component 기본, 인터랙션 필요한 경우만 `'use client'`
- 환경변수: `.env.local` 사용, 절대 하드코딩 금지
- Supabase 클라이언트: server/client 분리 (`supabase/server.ts`, `supabase/client.ts`)
- 외부 입력: `unknown`으로 받아 타입 가드로 좁힘 (`any` 금지)
- 새 파일은 작업 단위마다 한국어 WHAT 주석 + 비자명한 부분에 WHY 주석
