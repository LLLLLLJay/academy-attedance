# Supabase 스키마 설계 — 학원 출석체크 서비스

**문서 버전** v0.1 | **작성일** 2026.04.20

---

## 1. 테이블 관계도

```
academies
  └── students (N)
        ├── student_parents (N)   ← 뒷자리 4자리 검색
        └── attendance_logs (N)   ← 쿨타임 체크, 보강 메모
              └── notification_logs (N)  ← 발송 상태, 재시도 관리
```

---

## 2. 전체 스키마 SQL

```sql
  -- 1. academies (학원)
  create table academies (
    id                    uuid primary key default gen_random_uuid(),
    name                  text not null,
    admin_password_hash   text not null,   -- 관리자 로그인용 bcrypt 해시
    created_at            timestamptz default now()
  );

  -- 2. students (학생)
  create table students (
    id          uuid primary key default gen_random_uuid(),
    academy_id  uuid references academies(id) on delete cascade,
    name        text not null,
    is_active   boolean default true,      -- 퇴원 시 소프트 삭제
    created_at  timestamptz default now()
  );

  -- 3. student_parents (학부모 연락처, 1학생 N명)
  create table student_parents (
    id           uuid primary key default gen_random_uuid(),
    student_id   uuid references students(id) on delete cascade,
    name         text,                     -- 예: 엄마, 아빠, 할머니
    phone        text not null,            -- 전체 번호
    phone_last4  text generated always as
                  (right(phone, 4)) stored,
    is_primary   boolean default false,    -- 대표 연락처 여부
    created_at   timestamptz default now()
  );

  create index idx_student_parents_phone_last4
    on student_parents(phone_last4, student_id);

  -- 4. attendance_logs (출석/결석 기록)
  --    'absent'은 결석 관리 탭에서 (학생, 날짜) 단위로 INSERT/UPDATE 되는 보조 타입.
  --    같은 테이블에 통합해 "그 날 그 학생의 출석 상태"를 단일 소스로 조회.
  create type attendance_type as enum ('checkin', 'checkout', 'absent');

  create table attendance_logs (
    id          uuid primary key default gen_random_uuid(),
    student_id  uuid references students(id) on delete cascade,
    academy_id  uuid references academies(id) on delete cascade,
    type        attendance_type not null,
    checked_at  timestamptz default now(),
    memo        text,                      -- 결석 행의 보강 메모 (원장 입력)
    created_at  timestamptz default now()
  );

  create index idx_attendance_logs_student_date
    on attendance_logs(student_id, checked_at desc);

  create index idx_attendance_logs_academy_date
    on attendance_logs(academy_id, checked_at desc);

  -- 5. notification_logs (알림 발송 기록)
  create type notification_status as enum
    ('pending', 'sent', 'failed', 'retrying');

  create table notification_logs (
    id             uuid primary key default gen_random_uuid(),
    attendance_id  uuid references attendance_logs(id) on delete cascade,
    parent_id      uuid references student_parents(id) on delete cascade,
    status         notification_status default 'pending',
    attempt_count  int default 0,          -- 재시도 횟수 (최대 3)
    next_retry_at  timestamptz,            -- 다음 재시도 예정 시각
    sent_at        timestamptz,            -- 발송 성공 시각
    error_message  text,                   -- 실패 사유
    created_at     timestamptz default now()
  );
```

---

## 3. 테이블별 설명

| 테이블 | 역할 | 비고 |
|---|---|---|
| academies | 학원 정보 + 관리자 인증 | 멀티 학원 확장 대비 |
| students | 학생 목록 | is_active로 소프트 삭제 |
| student_parents | 학부모 연락처 (1학생 N명) | phone_last4 인덱스로 검색 최적화 |
| attendance_logs | 등원·하원·결석 기록 | type ∈ {checkin, checkout, absent}; memo는 결석 행의 보강 메모 |
| notification_logs | 알림톡 발송 상태 + 재시도 관리 | attempt_count 최대 3회 |

---

## 4. 핵심 쿼리

### 뒷자리 4자리로 학생 찾기
```sql
select s.id, s.name, sp.id as parent_id
from student_parents sp
join students s on s.id = sp.student_id
where sp.phone_last4 = '1234'
  and s.academy_id = $academy_id
  and s.is_active = true;
```

### 쿨타임 체크 (동일 타입 5분 이내)
```sql
select exists (
  select 1 from attendance_logs
  where student_id = $student_id
    and type = $type
    and checked_at > now() - interval '5 minutes'
);
```

### 당일 미출석 학생 조회 (대시보드 카드용)
```sql
select s.name
from students s
where s.academy_id = $academy_id
  and s.is_active = true
  and s.id not in (
    select student_id from attendance_logs
    where academy_id = $academy_id
      and type = 'checkin'
      and checked_at::date = current_date
  );
```

### 출석 기록 조회 — 등원/하원만 (결석 제외)
```sql
-- 관리자 출석 기록 페이지: type='absent'은 결석 관리 탭에서 따로 보여주므로 제외.
select al.id, al.student_id, s.name as student_name,
       al.type, al.checked_at, al.memo
from attendance_logs al
join students s on s.id = al.student_id
where al.academy_id = $academy_id
  and al.type in ('checkin', 'checkout')
  and al.checked_at >= $from_iso
order by al.checked_at desc;
```

### 결석 관리 — 학생 × 날짜 조합 중 등원 기록 없는 행
```sql
-- 학원 개원일 ~ 오늘(KST) 사이의 모든 (학생, 날짜)에서 type='checkin'이 없는 항목을 추린다.
-- 같은 (학생, 날짜)에 type='absent' 로그가 이미 있으면 그 row의 id/memo/created_at도 함께 반환.
-- ※ 실제 구현은 day-list 생성 + 두 번의 단일 쿼리(checkin/absent)를 메모리에서 anti-join 한다.
--   (route handler: src/app/api/admin/absences/route.ts 참고)
select s.id as student_id, s.name as student_name,
       d::date as date,
       a.id   as absence_log_id,
       a.memo as memo,
       a.created_at as memo_created_at
from students s
cross join generate_series(
  $academy_created_at::date,
  (now() at time zone 'Asia/Seoul')::date,
  interval '1 day'
) as d
left join attendance_logs a
  on a.student_id = s.id
 and a.academy_id = $academy_id
 and a.type = 'absent'
 and (a.checked_at at time zone 'Asia/Seoul')::date = d::date
where s.academy_id = $academy_id
  and s.is_active = true
  and (s.created_at at time zone 'Asia/Seoul')::date <= d::date
  and not exists (
    select 1 from attendance_logs c
    where c.student_id = s.id
      and c.academy_id = $academy_id
      and c.type = 'checkin'
      and (c.checked_at at time zone 'Asia/Seoul')::date = d::date
  )
order by d::date desc, s.name asc;
```

---

## 5. 설계 결정 사항 (ADR)

| 결정 | 이유 |
|---|---|
| student_parents를 별도 테이블로 분리 | 학부모 N명 지원, 뒷자리 4자리 인덱스 검색 최적화 |
| phone_last4를 generated column으로 | 저장 시 자동 계산, 별도 로직 불필요 |
| is_active 소프트 삭제 | 퇴원 학생 출석 기록 보존 |
| memo를 attendance_logs에 추가 | 결석(absent) row에 보강 메모를 붙이는 구조가 자연스러움 |
| attendance_type에 'absent' 추가 | 결석 관리 탭이 (학생, 날짜)별 보강 메모를 기록할 때, 별도 absences 테이블을 만드는 대신 같은 테이블의 type 분기로 처리해 단일 출석 상태 소스 유지 |
| admin_password_hash를 academies에 | Supabase Auth 없이 단순하게 처리, MVP에 적합 |
| academies 테이블 유지 | 현재 1개지만 멀티 학원 확장 대비 |

---

## 6. 미결 사항 (Next Steps)

- [ ] Supabase RLS(Row Level Security) 정책 설계
- [ ] notification_logs 재시도 스케줄러 (pg_cron + Edge Function) 설계
- [ ] 관리자 인증 방식 구체화 (JWT 또는 세션 쿠키)