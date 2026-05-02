/**
 * GET /api/academy — 현재 학원의 id + name 반환 (공개)
 *
 * 사용처: 태블릿 키오스크 부팅 시 화면 헤더에 학원명을 표시하기 위해 1회 호출.
 *         관리자 화면은 /api/admin/dashboard 응답에 academy_name이 포함되어 있어
 *         이 라우트를 직접 부르지 않는다 (인증 흐름 분리 유지).
 *
 * academy_id 결정 우선순위 — /api/attendance와 동일하게 맞춰 단일 학원 운영의
 * 모든 경로(출석/태블릿 헤더)가 같은 학원을 가리키도록 한다:
 *   1) NEXT_PUBLIC_ACADEMY_ID (운영에서 학원별로 박아 넣는 표준 경로)
 *   2) academies 테이블의 가장 오래된 row (단일 학원 운영 환경의 fallback)
 *
 * 인증을 두지 않는 이유:
 *   - 응답 데이터(학원 이름)는 알림톡 본문에 그대로 학부모에게 전달되는 "공개" 정보
 *   - 태블릿은 학원 내부 디바이스라 별도 인증 흐름이 없다
 *   학원 내부 데이터(학생/출결/연락처)는 절대 노출하지 않는다.
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

type AcademyResponse = {
  id: string;
  name: string;
};

export async function GET() {
  const supabase = await createClient();

  const envAcademyId = process.env.NEXT_PUBLIC_ACADEMY_ID ?? '';

  // 1) env에 박힌 ID가 있으면 그대로 단일 row 조회.
  if (envAcademyId) {
    const { data, error } = await supabase
      .from('academies')
      .select('id, name')
      .eq('id', envAcademyId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: 'DB_ERROR', detail: error.message },
        { status: 500 },
      );
    }
    if (!data) {
      // env가 가리키는 학원이 DB에 없음 — 환경변수 오설정 또는 학원 삭제.
      return NextResponse.json({ error: 'ACADEMY_NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ id: data.id, name: data.name } satisfies AcademyResponse);
  }

  // 2) env가 없으면 가장 오래된 학원 1개 — /api/attendance와 동일한 fallback 정책.
  const { data, error } = await supabase
    .from('academies')
    .select('id, name')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    // DB가 비어있음 — 초기 셋업 단계.
    return NextResponse.json({ error: 'ACADEMY_NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ id: data.id, name: data.name } satisfies AcademyResponse);
}
