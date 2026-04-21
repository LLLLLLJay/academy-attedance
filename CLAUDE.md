# 학원 출석체크 서비스 — Claude Code 컨텍스트

## 서비스 개요
학원 학생이 태블릿에서 부모님 뒷자리 4자리를 입력하면 등원/하원 출석이 처리되고,
부모님께 카카오 알림톡이 자동 발송되는 서비스.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| 백엔드 / DB | Supabase (PostgreSQL + RLS + Edge Functions) |
| 배포 | Vercel |
| 알림 발송 | 솔라피(Solapi) — 카카오 알림톡 + SMS 자동 대체 발송 |
| 재시도 스케줄러 | Supabase pg_cron + Edge Function |
| 버전 관리 | GitHub |

---

## 라우트 구조

```
/app
  /tablet          ← 학생용 출석 화면 (키오스크, 가로 고정)
  /admin           ← 원장용 관리자 페이지 (반응형)
  /api
    /attendance    ← 출석 처리 API
    /notify        ← 솔라피 알림톡 발송 API
    /auth          ← 관리자 로그인 API
```

---

## 핵심 비즈니스 로직

### 출석 체크 흐름
1. 태블릿에서 [등원 / 하원] 선택
2. 부모님 뒷자리 4자리 입력
3. student_parents 테이블에서 phone_last4로 학생 조회
4. 결과 1명 → 즉시 처리 / 2명 이상 → 이름 목록 선택
5. attendance_logs에 기록
6. 솔라피 API로 알림톡 발송 (5초 이내 목표)
7. 완료 메시지 후 초기 화면 복귀

### 쿨타임 규칙
- 동일 학생 + 동일 타입(등원→등원 / 하원→하원) 기준 5분 이내 재입력 차단
- 등원 후 하원은 쿨타임 없이 허용

### 알림톡 재시도 (Exponential Backoff)
- 1차 실패 → 1분 후 재시도
- 2차 실패 → 5분 후 재시도
- 3차 실패 → 15분 후 재시도
- 3회 모두 실패 시 → 관리자 페이지에 실패 내역 표시

---

## DB 스키마 요약

```
academies          학원 정보 + 관리자 비밀번호 해시
students           학생 목록 (is_active로 소프트 삭제)
student_parents    학부모 연락처 (1학생 N명, phone_last4 인덱스)
attendance_logs    등원/하원 기록 (type: checkin | checkout, memo 컬럼 포함)
notification_logs  알림톡 발송 상태 + 재시도 관리 (attempt_count 최대 3)
```

전체 스키마 SQL → SCHEMA.md 참고

---

## 알림톡 템플릿

```
등원: [#{학원명}] #{학생명} 학생이 #{시각}에 등원했습니다.
하원: [#{학원명}] #{학생명} 학생이 #{시각}에 하원했습니다.
```

솔라피 변수 매핑 → ALIMTALK_TEMPLATE.md 참고

---

## 태블릿 UI 요구사항
- 가로 모드 고정 (1280×800 기준)
- 브라우저 풀스크린 권장
- 버튼 최소 120px 높이 (터치 친화적)
- 폰트 최소 24px
- 등원 = 따뜻한 색 계열 / 하원 = 차가운 색 계열
- 화면당 행동 1개만

## 관리자 페이지 요구사항
- 모바일 / PC 반응형
- 기존 UI 라이브러리 활용 (shadcn/ui 권장)
- 관리자 인증: 단순 비밀번호 (bcrypt 해시, Supabase Auth 미사용)

---

## 참고 문서
- `PRD_v0.2.md` — 전체 기능 요구사항 + 엣지케이스
- `SCHEMA.md` — Supabase 스키마 SQL + 핵심 쿼리
- `ALIMTALK_TEMPLATE.md` — 솔라피 알림톡 템플릿 + 연동 가이드

---

## 코드 작성 규칙
- 언어: TypeScript (strict mode)
- 스타일: Tailwind CSS only (별도 CSS 파일 금지)
- 컴포넌트: Server Component 기본, 인터랙션 필요한 경우만 'use client'
- 환경변수: .env.local 사용, 절대 하드코딩 금지
- Supabase 클라이언트: server/client 분리 (supabase/server.ts, supabase/client.ts)