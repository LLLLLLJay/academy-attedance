# 학원 출석체크 서비스

학원 학생이 태블릿에서 부모님 전화번호 뒷자리 4자리를 입력하면 등원/하원이 기록되고, 부모님께 카카오 알림톡이 자동 발송되는 서비스.

## 기술 스택

- **프론트엔드**: Next.js 16 (App Router, React 19) + TypeScript + Tailwind CSS v4
- **백엔드 / DB**: Supabase (PostgreSQL + RLS + Edge Functions)
- **관리자 인증**: bcrypt 비밀번호 해시 + jose JWT(HS256, 7d) httpOnly 쿠키, middleware로 `/admin/*` 가드
- **알림 발송**: 솔라피(Solapi) 카카오 알림톡 (검수 통과 후 SMS 자동 대체)
- **재시도 스케줄러**: Supabase pg_cron + Edge Function (1분 → 5분 → 15분 백오프, 최대 3회)
- **배포**: Vercel
- **폰트**: Pretendard

## 라우트 구조

### 페이지

| 경로 | 설명 | 인증 |
|---|---|---|
| `/` | `/tablet`으로 리다이렉트 | — |
| `/tablet` | 학생용 출석 키오스크 (가로 1280×800 고정) | 없음 |
| `/admin/login` | 관리자 비밀번호 로그인 | 없음 |
| `/admin` | 관리자 대시보드 / 출석 기록 / 학생 관리 / 결석 관리 / 발송 실패 | JWT 쿠키 (middleware 가드) |

### API

| 메서드·경로 | 설명 |
|---|---|
| `POST /api/attendance` | 키오스크 출석 처리 (학생 조회 → 쿨타임 → 로그 INSERT → 알림 트리거) |
| `POST /api/notify` | 솔라피 알림톡 발송 + 재시도 상태 갱신 (key/PFID/템플릿 환경변수 필요) |
| `POST /api/auth` | 관리자 로그인 (비밀번호 검증 후 JWT 쿠키 발급) |
| `DELETE /api/auth` | 관리자 로그아웃 (쿠키 만료) |
| `GET /api/admin/dashboard` | 대시보드 카운트(총원/등원/하원) + 최근 활동 10건 |
| `GET /api/admin/attendance` | 출석 기록 (등원/하원만, 기간·타입·학생 필터) |
| `PATCH /api/admin/attendance/[id]` | 출석 row의 메모 인라인 수정 |
| `GET /api/admin/absentees` | 오늘 미등원 학생 카운트용 리스트 |
| `GET /api/admin/absences` | 결석 관리 — 등원 기록이 없는 (학생, 날짜) + absent row 메모 |
| `POST /api/admin/absences` | 결석 보강 메모 INSERT/UPDATE |
| `GET /api/admin/students` | 학생·학부모 목록 |
| `POST /api/admin/students` | 학생 등록 (학부모 N명 함께) |
| `PATCH /api/admin/students/[id]` | 학생 정보 / 학부모 / 활성 상태 수정 |
| `DELETE /api/admin/students/[id]` | 학생 소프트 삭제 (`is_active=false`) |
| `GET /api/admin/notifications/failed` | 3회 실패한 알림 + 재시도 중 알림 목록 |

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경변수 설정

프로젝트 루트에 `.env.local` 파일 생성. 카카오 비즈채널 검수 전이라면 `SOLAPI_PFID` / `SOLAPI_TEMPLATE_ID_*` 는 비워두면 알림톡 호출 시 `SOLAPI_TEMPLATE_ENV_MISSING`으로 응답되며, 출석 기록 자체는 정상 처리됩니다.

```env
# Supabase ─────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...

# 관리자 JWT 서명 키 (32자 이상의 무작위 문자열 권장)
JWT_SECRET=replace-with-long-random-string

# 키오스크가 사용할 학원 ID (선택)
# 비워두면 academies 테이블의 첫 row를 자동으로 사용 (단일 학원 운영 환경)
NEXT_PUBLIC_ACADEMY_ID=

# 솔라피 (Solapi) ──────────────────────────────────────
SOLAPI_API_KEY=
SOLAPI_API_SECRET=
SOLAPI_SENDER=01012345678          # 발신 등록된 번호

# 카카오 알림톡 (검수 통과 후 발급)
SOLAPI_PFID=                       # 비즈채널 발신 프로필 ID
SOLAPI_TEMPLATE_ID_CHECKIN=        # 등원 템플릿 ID
SOLAPI_TEMPLATE_ID_CHECKOUT=       # 하원 템플릿 ID
```

### 3. Supabase 스키마 세팅

[SCHEMA.md](./SCHEMA.md)의 SQL을 Supabase SQL Editor에서 실행한 뒤, `academies` 테이블에 학원 1건과 bcrypt 해시한 관리자 비밀번호를 INSERT.

```sql
-- 예시: 비밀번호 해시는 Node REPL에서
--   require('bcryptjs').hashSync('mypassword', 10)
insert into academies (name, admin_password_hash)
values ('새벽별 학원', '$2a$10$...');
```

### 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 접속 (자동으로 `/tablet`으로 이동).
관리자 페이지는 [http://localhost:3000/admin/login](http://localhost:3000/admin/login).

## 스크립트

| 명령어 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 프로덕션 서버 실행 |
| `npm run lint` | ESLint 검사 |

## 참고 문서

- [CLAUDE.md](./CLAUDE.md) — Claude Code용 프로젝트 컨텍스트
- [PRD_v0.3.md](./PRD_v0.3.md) — 전체 기능 요구사항 + 엣지케이스
- [SCHEMA.md](./SCHEMA.md) — Supabase 스키마 SQL + 핵심 쿼리
- [ALIMTALK_TEMPLATE.md](./ALIMTALK_TEMPLATE.md) — 솔라피 알림톡 템플릿 + 연동 가이드

## 배포

Vercel 연결 후 위 환경변수 전체를 Vercel 프로젝트 설정에 추가하면 자동 배포됩니다. 운영 환경에서는 `JWT_SECRET`과 솔라피 키가 노출되지 않도록 반드시 Vercel Environment Variables에서 관리하세요.
