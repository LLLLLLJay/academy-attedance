/**
 * LogoutButton — 관리자 로그아웃 버튼
 *
 * 동작:
 *   1. DELETE /api/auth 호출 → 서버가 admin_token 쿠키를 만료시킴
 *   2. /admin/login으로 라우팅 + router.refresh()로 미들웨어 재평가 트리거
 *
 * why className/style/children prop:
 *   사이드바와 모바일 헤더 등 위치마다 디자인이 달라 자체 스타일을 강제하지 않고
 *   호출부에서 외형을 결정하도록 위임. 로직만 공유.
 */

'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export default function LogoutButton({ className, style, children }: Props) {
  // 중복 클릭 방지 — 네트워크가 느릴 때 같은 요청이 여러 번 가는 걸 막는다.
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleClick() {
    if (loading) return;
    setLoading(true);

    // 네트워크 오류여도 사용자 입장에선 "로그아웃 시도 = 로그인 화면 복귀"가 일관된 UX.
    // why try/catch만 두고 finally에서 리다이렉트:
    //   서버 호출 실패해도 클라이언트는 어차피 보호된 페이지에 머물 권한이 없음.
    //   redirect 후 미들웨어가 다시 토큰 검증 → 쿠키가 살아있으면 그대로 통과,
    //   사라졌으면 로그인 페이지로 다시 보냄.
    try {
      await fetch('/api/auth', { method: 'DELETE' });
    } catch {
      // 의도적으로 무시
    }

    // why router.refresh와 함께 호출:
    //   App Router 클라이언트 캐시 때문에 push만으로는 미들웨어가 재평가되지 않을 수 있음.
    //   refresh로 서버 측 데이터 + 미들웨어를 재실행해 새 쿠키 상태를 반영.
    router.push('/admin/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={className}
      style={style}
    >
      {children ?? '로그아웃'}
    </button>
  );
}
