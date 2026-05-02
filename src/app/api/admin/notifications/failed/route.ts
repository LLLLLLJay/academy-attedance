/**
 * /api/admin/notifications/failed — 발송 문제가 있는 알림톡 목록 조회
 *
 * 가드: admin JWT 쿠키 검증 후 academy_id를 claims에서 꺼내 사용한다.
 *      쿼리스트링/본문으로 받은 academy_id는 신뢰하지 않음 — 다른 학원 데이터 노출 방지.
 *
 * GET: notification_logs.status in ('failed', 'retrying') 조회.
 *      - failed   : 자동 재시도 3회까지 모두 실패한 최종 실패 행
 *      - retrying : 재시도 대기 중이지만 pg_cron 미설치 환경에서는 영원히 멈춰 있는 행도 포함
 *      운영자가 둘 다 수동 재전송 대상으로 인지해야 하므로 함께 노출한다.
 *
 *      notification_logs는 academy_id를 직접 갖지 않으므로 attendance_logs!inner로
 *      조인 후 attendance_logs.academy_id로 학원을 격리한다.
 *      학생 이름/학부모 정보를 응답에 평탄화해 UI가 곧바로 그릴 수 있게 한다.
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';
import type {
  AttendanceType,
  NotificationStatus,
} from '@/lib/types/database';

// 클라이언트 응답 형태 — UI에서 바로 사용할 수 있도록 student/parent를 평탄화.
// status 필드를 함께 내려보내 UI에서 "재시도 대기" / "최종 실패" 뱃지를 분기한다.
type FailedNotificationResponse = {
  id: string;
  attendance_id: string;
  student_id: string;
  student_name: string;
  parent_name: string | null;
  parent_phone: string;
  type: AttendanceType;
  status: Extract<NotificationStatus, 'failed' | 'retrying'>;
  attempt_count: number;
  error_message: string | null;
  attempted_at: string;
};

// supabase-js의 inner join 결과는 단일 객체 또는 배열로 추론될 수 있어 둘 다 허용.
type JoinedRow = {
  id: string;
  attendance_id: string;
  status: NotificationStatus;
  attempt_count: number;
  error_message: string | null;
  created_at: string;
  attendance_logs:
    | {
        id: string;
        type: AttendanceType;
        checked_at: string;
        academy_id: string;
        students: { id: string; name: string } | { id: string; name: string }[] | null;
      }
    | {
        id: string;
        type: AttendanceType;
        checked_at: string;
        academy_id: string;
        students: { id: string; name: string } | { id: string; name: string }[] | null;
      }[]
    | null;
  student_parents:
    | { id: string; name: string | null; phone: string }
    | { id: string; name: string | null; phone: string }[]
    | null;
};

function pickOne<T>(rel: T | T[] | null): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

export async function GET() {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const supabase = await createClient();

  // attendance_logs!inner — academy_id 격리는 조인된 attendance_logs 컬럼을 통해 적용한다.
  // students!inner / student_parents!inner — 부모/학생 row가 누락된 고아 알림은 응답에서 제외.
  const { data, error } = await supabase
    .from('notification_logs')
    .select(
      `
        id,
        attendance_id,
        status,
        attempt_count,
        error_message,
        created_at,
        attendance_logs!inner (
          id,
          type,
          checked_at,
          academy_id,
          students!inner ( id, name )
        ),
        student_parents!inner ( id, name, phone )
      `,
    )
    .in('status', ['failed', 'retrying'])
    .eq('attendance_logs.academy_id', claims.academy_id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: error.message },
      { status: 500 },
    );
  }

  const notifications: FailedNotificationResponse[] = ((data ?? []) as JoinedRow[])
    .map((row) => {
      const attendance = pickOne(row.attendance_logs);
      const student = pickOne(attendance?.students ?? null);
      const parent = pickOne(row.student_parents);
      if (!attendance || !student || !parent) return null;
      // status 필터는 in()에서 이미 좁혀졌지만 타입을 좁히기 위해 한 번 더 확인.
      // sent/pending이 섞여 들어오는 일은 없어야 하지만 방어적으로 걸러둔다.
      if (row.status !== 'failed' && row.status !== 'retrying') return null;
      return {
        id: row.id,
        attendance_id: row.attendance_id,
        student_id: student.id,
        student_name: student.name,
        parent_name: parent.name,
        parent_phone: parent.phone,
        type: attendance.type,
        status: row.status,
        attempt_count: row.attempt_count,
        error_message: row.error_message,
        attempted_at: attendance.checked_at,
      };
    })
    .filter((n): n is FailedNotificationResponse => n !== null);

  return NextResponse.json({ notifications });
}
