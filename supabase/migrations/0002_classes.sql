-- 0002_classes.sql
--
-- 클래스(반) 도입 마이그레이션.
--   1) classes 테이블 — 학원별 반 정의 (이름 + 수업 요일 배열)
--   2) student_classes 테이블 — 학생 ↔ 클래스 다대다 (한 학생이 여러 반 가능)
--
-- WHY: 학생별 출석 기대 요일을 도출하기 위함. 결석 판정/대시보드 집계가
--      "학생이 속한 클래스 중 어느 하나라도 오늘 수업이 있는가"의 합집합 기준으로 동작한다.
--      출석체크 API는 클래스 요일과 무관하게 항상 허용 (보강 수업 케이스 지원).

-- ── 1) classes ─────────────────────────────────────────────────────────────
create table if not exists classes (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references academies(id) on delete cascade,
  name        text not null,
  -- 0=일 ~ 6=토 (JS Date.getDay()와 동일). 빈 배열 = 휴강.
  -- WHY: int[]로 두면 PostgREST에서 그대로 노출돼 클라이언트 변환이 단순.
  --      운영상 수업이 매주 같은 요일에 일정하게 잡힌다는 가정을 따른다.
  weekdays    smallint[] not null default '{}',
  created_at  timestamptz not null default now(),
  constraint classes_weekdays_range check (
    weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);

create index if not exists idx_classes_academy on classes(academy_id);

-- ── 2) student_classes (조인 테이블) ──────────────────────────────────────
create table if not exists student_classes (
  student_id uuid not null references students(id) on delete cascade,
  class_id   uuid not null references classes(id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, class_id)
);

-- 클래스 단위 학생 조회용 보조 인덱스 (PK는 student_id가 선두라 학생→클래스는 이미 빠름).
create index if not exists idx_student_classes_class on student_classes(class_id);
