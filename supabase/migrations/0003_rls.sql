-- 0003_rls.sql
--
-- 모든 테이블 RLS 활성화. 정책을 만들지 않으면 anon/authenticated 역할의 모든 접근이 거부된다.
-- 서버측은 service_role 키로 RLS를 우회 (서버가 신뢰 경계).
--
-- WHY: anon 키가 NEXT_PUBLIC_으로 브라우저 번들에 노출돼 PostgREST 직접 호출 시
--      student_parents.phone 등 민감 데이터 덤프가 가능했던 상태를 차단.
--      앱은 Supabase Auth를 쓰지 않고 자체 jose JWT 쿠키로 인증하므로
--      anon에 대한 정책은 만들 필요가 없다 — 0 row 반환이 정상.

alter table academies         enable row level security;
alter table students          enable row level security;
alter table student_parents   enable row level security;
alter table classes           enable row level security;
alter table student_classes   enable row level security;
alter table attendance_logs   enable row level security;
alter table notification_logs enable row level security;

-- 명시적 정책 없음 = anon/authenticated 전면 거부.
-- service_role은 RLS를 우회하므로 정책 없이도 서버 라우트는 정상 동작.
