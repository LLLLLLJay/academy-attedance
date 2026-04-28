/**
 * /api/admin/classes — 관리자 클래스(반) 관리 (목록/등록)
 *
 * 가드: admin JWT 쿠키 검증 후 academy_id를 claims에서 꺼내 사용한다.
 *      쿼리스트링/본문으로 받은 academy_id는 절대 신뢰하지 않음 (다른 학원 데이터 노출 방지).
 *
 * GET:  현재 학원의 모든 클래스 + 소속 학생 ID 목록 일괄 조회
 * POST: 클래스 1개 + 학생 N명 배정을 트랜잭션처럼 등록
 *       (클래스 INSERT 실패 시 학생 배정도 만들지 않음)
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';
import type { TablesInsert, Weekday } from '@/lib/types/database';

// 클라이언트 응답 형태 — 클래스 + 소속 학생 id/이름 평탄화.
// student_count는 UI 카드 표시에 자주 쓰여 미리 계산해 보낸다 (length로도 가능하지만 명시적).
type ClassResponse = {
  id: string;
  academy_id: string;
  name: string;
  weekdays: Weekday[];
  created_at: string;
  student_count: number;
  students: { id: string; name: string }[];
};

// POST 본문 형태 — 외부 입력은 unknown으로 받아 런타임 검증.
type ClassCreateBody = {
  name?: unknown;
  weekdays?: unknown;
  student_ids?: unknown;
};

// 입력된 weekdays를 0..6 정수만 남기고 중복 제거 + 정렬.
// why: DB CHECK 제약(0~6)을 지키고, 응답이 항상 안정된 순서를 갖도록 정규화.
function sanitizeWeekdays(input: unknown): Weekday[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<number>();
  for (const v of input) {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  return Array.from(set).sort((a, b) => a - b) as Weekday[];
}

// student_ids 입력에서 비어있지 않은 문자열만 골라 중복 제거.
function sanitizeStudentIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const v of input) {
    if (typeof v === 'string' && v.length > 0) set.add(v);
  }
  return Array.from(set);
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const supabase = await createClient();

  const { data: classes, error: classesErr } = await supabase
    .from('classes')
    .select('id, academy_id, name, weekdays, created_at')
    .eq('academy_id', claims.academy_id)
    .order('created_at', { ascending: true });

  if (classesErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: classesErr.message },
      { status: 500 },
    );
  }

  if (!classes || classes.length === 0) {
    return NextResponse.json({ classes: [] satisfies ClassResponse[] });
  }

  const classIds = classes.map((c) => c.id);

  // 소속 학생 — 활성 학생만 노출 (퇴원생은 카운트/리스트에서 제외).
  // 한 번의 join으로 student_classes + students를 함께 가져와 N+1 방지.
  const { data: links, error: linksErr } = await supabase
    .from('student_classes')
    .select('class_id, student_id, students!inner(id, name, is_active)')
    .in('class_id', classIds);

  if (linksErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: linksErr.message },
      { status: 500 },
    );
  }

  // class_id별 학생 리스트를 만들어 클래스 row에 합친다.
  // supabase-js의 inner join 결과는 배열 또는 단일 객체로 추론될 수 있어 둘 다 허용.
  type LinkRow = {
    class_id: string;
    student_id: string;
    students:
      | { id: string; name: string; is_active: boolean }
      | { id: string; name: string; is_active: boolean }[]
      | null;
  };

  const studentsByClass = new Map<string, { id: string; name: string }[]>();
  for (const raw of (links ?? []) as LinkRow[]) {
    const rel = Array.isArray(raw.students) ? raw.students[0] : raw.students;
    if (!rel || !rel.is_active) continue;
    const list = studentsByClass.get(raw.class_id) ?? [];
    list.push({ id: rel.id, name: rel.name });
    studentsByClass.set(raw.class_id, list);
  }

  const result: ClassResponse[] = classes.map((c) => {
    const students = (studentsByClass.get(c.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, 'ko'),
    );
    return {
      id: c.id,
      academy_id: c.academy_id,
      name: c.name,
      weekdays: (c.weekdays ?? []) as Weekday[],
      created_at: c.created_at,
      student_count: students.length,
      students,
    };
  });

  return NextResponse.json({ classes: result });
}

// ── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: ClassCreateBody;
  try {
    body = (await request.json()) as ClassCreateBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'MISSING_NAME' }, { status: 400 });
  }

  const weekdays = sanitizeWeekdays(body.weekdays);
  const studentIds = sanitizeStudentIds(body.student_ids);

  const supabase = await createClient();

  // 클래스 INSERT — id를 받아야 학생 배정 행을 만들 수 있음.
  const classInsert: TablesInsert<'classes'> = {
    academy_id: claims.academy_id,
    name,
    weekdays,
  };
  const { data: created, error: createErr } = await supabase
    .from('classes')
    .insert(classInsert)
    .select('id, academy_id, name, weekdays, created_at')
    .single();

  if (createErr || !created) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: createErr?.message ?? 'class insert failed' },
      { status: 500 },
    );
  }

  // 학생 배정이 있으면 — 같은 학원 + 활성 학생만 화이트리스트로 좁혀 INSERT.
  // why: 클라이언트가 다른 학원 학생 id를 끼워 보내도 무시되도록 서버에서 한 번 검증.
  if (studentIds.length > 0) {
    const { data: validStudents, error: validErr } = await supabase
      .from('students')
      .select('id')
      .in('id', studentIds)
      .eq('academy_id', claims.academy_id)
      .eq('is_active', true);

    if (validErr) {
      // 클래스는 이미 생성됨 → 보상으로 삭제 후 에러 반환.
      await supabase.from('classes').delete().eq('id', created.id);
      return NextResponse.json(
        { error: 'DB_ERROR', detail: validErr.message },
        { status: 500 },
      );
    }

    const allowedIds = new Set((validStudents ?? []).map((s) => s.id));
    const linkRows: TablesInsert<'student_classes'>[] = studentIds
      .filter((id) => allowedIds.has(id))
      .map((student_id) => ({ student_id, class_id: created.id }));

    if (linkRows.length > 0) {
      const { error: linkErr } = await supabase
        .from('student_classes')
        .insert(linkRows);
      if (linkErr) {
        await supabase.from('classes').delete().eq('id', created.id);
        return NextResponse.json(
          { error: 'DB_ERROR', detail: linkErr.message },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json(
    {
      class: {
        id: created.id,
        academy_id: created.academy_id,
        name: created.name,
        weekdays: (created.weekdays ?? []) as Weekday[],
        created_at: created.created_at,
      },
    },
    { status: 201 },
  );
}
