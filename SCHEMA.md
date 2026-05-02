# Supabase 스키마 설계 — 학원 출석체크 서비스

**문서 버전** v0.3 | **작성일** 2026.04.28

---

## 1. 테이블 관계도

```
academies
  ├── classes (N)                  ← 반(클래스) — 이름 + 수업 요일
  │     └── student_classes (N×N)  ← 학생 ↔ 클래스 다대다 조인
  └── students (N)
        ├── student_parents (N)    ← 뒷자리 4자리 검색
        ├── student_classes (N×N)  ← 위 조인 테이블
        └── attendance_logs (N)    ← 쿨타임 체크, 보강 메모
              └── notification_logs (N)  ← 발송 상태, 재시도 관리
```

---

## 1-a. 마이그레이션 파일

실제 적용 SQL은 `supabase/migrations/` 아래에 순서대로 보관한다. 새 환경 세팅 시 파일 번호 순으로 Supabase SQL Editor에 그대로 실행하면 된다.

| 파일 | 내용 |
|---|---|
| `0001_initial.sql` | academies / students / student_parents / attendance_logs / notification_logs (현재 미작성 — 아래 §2의 SQL을 그대로 사용) |
| `supabase/migrations/0002_classes.sql` | classes / student_classes (반 도입) |

> 본 문서 §2는 "현재 시점의 최종 스키마"를 한곳에 모은 참고용 정의다. 운영 DB에는 마이그레이션 파일을 통해 점진 적용한다.

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
    academy_id  uuid not null references academies(id) on delete cascade,
    name        text not null,
    is_active   boolean default true,      -- 퇴원 시 소프트 삭제
    created_at  timestamptz default now()
  );

  -- 3. student_parents (학부모 연락처, 1학생 N명)
  create table student_parents (
    id           uuid primary key default gen_random_uuid(),
    student_id   uuid not null references students(id) on delete cascade,
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
    student_id  uuid not null references students(id) on delete cascade,
    academy_id  uuid not null references academies(id) on delete cascade,
    type        attendance_type not null,
    checked_at  timestamptz not null default now(),
    memo        text,                      -- 결석 행의 보강 메모 (원장 입력)
    created_at  timestamptz default now()
  );

  create index idx_attendance_logs_student_date
    on attendance_logs(student_id, checked_at desc);

  create index idx_attendance_logs_academy_date
    on attendance_logs(academy_id, checked_at desc);

  -- 5. classes (반)
  --    수업이 매주 같은 요일에 일정하게 잡힌다는 가정.
  --    weekdays는 0(일)~6(토)의 정수 배열 — JS Date.getDay()와 동일.
  create table classes (
    id          uuid primary key default gen_random_uuid(),
    academy_id  uuid not null references academies(id) on delete cascade,
    name        text not null,
    weekdays    smallint[] not null default '{}',
    created_at  timestamptz not null default now(),
    constraint classes_weekdays_range check (
      weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
    )
  );

  create index idx_classes_academy on classes(academy_id);

  -- 6. student_classes (학생 ↔ 클래스 다대다 조인)
  create table student_classes (
    student_id uuid not null references students(id) on delete cascade,
    class_id   uuid not null references classes(id)  on delete cascade,
    created_at timestamptz not null default now(),
    primary key (student_id, class_id)
  );

  create index idx_student_classes_class on student_classes(class_id);

  -- 7. notification_logs (알림 발송 기록)
  create type notification_status as enum
    ('pending', 'sent', 'failed', 'retrying');

  create table notification_logs (
    id             uuid primary key default gen_random_uuid(),
    attendance_id  uuid not null references attendance_logs(id) on delete cascade,
    parent_id      uuid not null references student_parents(id) on delete cascade,
    status         notification_status not null default 'pending',
    attempt_count  int not null default 0, -- 재시도 횟수 (최대 3)
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
| classes | 반(클래스) 정의 | weekdays 배열로 매주 수업 요일 지정 (0=일~6=토) |
| student_classes | 학생 ↔ 클래스 다대다 | 한 학생이 여러 반에 소속 가능 (PK = student_id+class_id) |
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
-- 오늘 KST 요일($weekday: 0=일~6=토)에 수업하는 클래스에 속한 활성 학생 중
-- 등원(checkin) 기록이 없는 학생만 미출석으로 잡는다.
-- 클래스 미배정 학생은 분모에서 자동 제외 — 출석 의무 자체가 정의되지 않음.
select distinct s.id, s.name
from students s
join student_classes sc on sc.student_id = s.id
join classes c on c.id = sc.class_id
where s.academy_id = $academy_id
  and s.is_active = true
  and c.academy_id = $academy_id
  and $weekday = any(c.weekdays)
  and s.id not in (
    select student_id from attendance_logs
    where academy_id = $academy_id
      and type = 'checkin'
      and checked_at >= $today_kst_start_iso
      and checked_at <  $today_kst_end_iso
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

### 오늘 수업이 있는 활성 학생 (대시보드 / 미등원 분모)
```sql
-- KST 기준 오늘 요일($weekday: 0=일~6=토)에 수업하는 클래스에 속한 활성 학생.
-- 한 학생이 여러 반에 속해도 distinct로 1명으로 집계.
select distinct s.id, s.name
from students s
join student_classes sc on sc.student_id = s.id
join classes c on c.id = sc.class_id
where s.academy_id = $academy_id
  and s.is_active = true
  and c.academy_id = $academy_id
  and $weekday = any(c.weekdays);
```

### 결석 관리 — 학생 × 날짜 조합 중 등원 기록 없는 행
```sql
-- 학원 개원일 ~ 오늘(KST) 사이의 (학생, 날짜)에서 type='checkin'이 없는 항목을 추린다.
-- 단, 학생이 속한 클래스의 수업 요일에 해당하는 날짜만 결석 후보로 본다 (학생별 weekdays 합집합).
-- 클래스 미배정 학생은 분모 자체가 비어 결석 집계에서 제외.
-- 같은 (학생, 날짜)에 type='absent' 로그가 이미 있으면 그 row의 id/memo/created_at도 함께 반환.
-- ※ 실제 구현은 day-list 생성 + 학생별 weekday 합집합 + 두 번의 단일 쿼리(checkin/absent)를
--   메모리에서 anti-join 한다. (route handler: src/app/api/admin/absences/route.ts 참고)
select s.id as student_id, s.name as student_name,
       d::date as date,
       a.id   as absence_log_id,
       a.memo as memo,
       a.created_at as memo_created_at
from students s
join lateral (
  -- 학생별 수업 요일 합집합 — 어느 한 반이라도 수업 있는 요일을 모두 모은다.
  select array_agg(distinct w) as weekdays
  from student_classes sc
  join classes c on c.id = sc.class_id
  cross join lateral unnest(c.weekdays) as w
  where sc.student_id = s.id
    and c.academy_id  = $academy_id
) sw on true
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
  and sw.weekdays is not null                   -- 클래스 미배정 학생 제외
  and extract(dow from d)::int = any(sw.weekdays)  -- 수업 요일만 후보
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
| classes.weekdays를 smallint[] | 비트마스크보다 가독성·쿼리 단순함. `&&`/`= any()` 연산자로 요일 매칭 즉시 가능 |
| student_classes를 다대다 조인 테이블로 | 실제론 1인 1반이지만 향후 영어반·수학반 동시 소속 등 확장 케이스 대비 |
| 출석체크는 클래스 요일과 무관하게 항상 허용 | 보강 수업 케이스 — 수업 없는 날에도 등원/하원 처리 + 알림톡 발송 |
| 결석 판정은 클래스 요일 합집합 기준 | 수업 없는 요일을 결석으로 잡지 않기 위함. 미배정 학생은 집계에서 제외 |

---

## 6. 미결 사항 (Next Steps)

- [ ] Supabase RLS(Row Level Security) 정책 설계
- [ ] notification_logs 재시도 스케줄러 (pg_cron + Edge Function) 설계