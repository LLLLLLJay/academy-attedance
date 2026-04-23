# 학원 출석체크 서비스

학원 학생이 태블릿에서 부모님 전화번호 뒷자리 4자리를 입력하면
등원/하원이 기록되고, 부모님께 카카오 알림톡이 자동 발송되는 서비스.

## 기술 스택

- **프론트엔드**: Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **백엔드 / DB**: Supabase (PostgreSQL + RLS + Edge Functions)
- **알림 발송**: 솔라피(Solapi) — 카카오 알림톡 + SMS 자동 대체
- **재시도 스케줄러**: Supabase pg_cron + Edge Function
- **배포**: Vercel
- **폰트**: Pretendard

## 라우트 구조

| 경로 | 설명 |
|---|---|
| `/tablet` | 학생용 출석 키오스크 화면 (가로 1280×800 고정) |
| `/admin` | 원장용 관리자 페이지 (반응형) |
| `/api/attendance` | 출석 처리 API |
| `/api/notify` | 솔라피 알림톡 발송 API |
| `/api/auth` | 관리자 로그인 API |

루트(`/`) 접속 시 `/tablet`으로 리다이렉트됩니다.

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경변수 설정

프로젝트 루트에 `.env.local` 파일 생성:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# 솔라피 (Solapi)
SOLAPI_API_KEY=
SOLAPI_API_SECRET=
SOLAPI_SENDER_PHONE=
SOLAPI_PFID=           # 카카오 플러스친구 ID
```

### 3. Supabase 스키마 세팅

[SCHEMA.md](./SCHEMA.md)의 SQL을 Supabase SQL Editor에서 실행.

### 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 접속.

## 스크립트

| 명령어 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 프로덕션 서버 실행 |
| `npm run lint` | ESLint 검사 |

## 참고 문서

- [CLAUDE.md](./CLAUDE.md) — Claude Code용 프로젝트 컨텍스트
- [PRD_v0.2.md](./PRD_v0.2.md) — 전체 기능 요구사항 + 엣지케이스
- [SCHEMA.md](./SCHEMA.md) — Supabase 스키마 SQL + 핵심 쿼리
- [ALIMTALK_TEMPLATE.md](./ALIMTALK_TEMPLATE.md) — 솔라피 알림톡 템플릿 + 연동 가이드

## 배포

Vercel 연결 후 동일한 환경변수를 Vercel 프로젝트 설정에 추가하면 자동 배포됩니다.
