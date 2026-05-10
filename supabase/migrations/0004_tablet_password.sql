-- 0004_tablet_password.sql
--
-- /tablet 키오스크 로그인용 별도 비밀번호. admin_password_hash와 분리해 권한을 나눈다.
--
-- WHY 별도 컬럼:
--   - 학원 1곳·운영자 1~2명 가정 (MVP). 직원 N명으로 확장되면 별도 academy_users 테이블로 진화.
--   - admin과 tablet의 비밀번호가 다른 이유: tablet은 학원 내 공용 기기에 한 번 로그인해 두는
--     "낮은 권한" 토큰이고, admin은 운영자 개인의 "높은 권한" 토큰이라 노출 면적이 다르다.
--   - admin 비밀번호가 tablet에 박히면 분실/유출 시 관리자 페이지까지 함께 털린다.
--
-- 시딩(update academies set tablet_password_hash = '<bcrypt>')은 운영자가 별도 SQL로 직접 수행.
-- 마이그레이션은 컬럼만 만들고 비워 둔다.

alter table academies
  add column if not exists tablet_password_hash text;
