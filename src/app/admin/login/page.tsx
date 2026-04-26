/**
 * /admin/login — 관리자 로그인 페이지
 *
 * 흐름:
 *   1. 비밀번호 입력 → POST /api/auth
 *   2. 200 → /admin으로 라우팅 (router.refresh로 미들웨어가 새 쿠키 인지하도록)
 *   3. 401 → "비밀번호 불일치" 표시
 *   4. 그 외 → 일반 오류 표시
 */

'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  // 폼 상태 — 한 페이지에 입력 1개라 useState로 충분 (form library 불필요)
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const router = useRouter();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    // 기본 form 제출(브라우저가 페이지 이동) 막고 fetch로 처리
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // /api/auth 호출. 쿠키는 응답의 Set-Cookie 헤더로 자동 저장되므로
      // 클라이언트에서 별도 처리 불필요.
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // why router.refresh:
        //   App Router는 클라이언트 캐시를 갖고 있어 push만 하면 미들웨어 결과(쿠키 검증)가
        //   재평가되지 않을 수 있음. refresh를 같이 호출해 서버 측 데이터·미들웨어를 재실행.
        router.push('/admin');
        router.refresh();
        return;
      }

      if (res.status === 401) {
        setError('비밀번호가 일치하지 않습니다.');
      } else {
        // 400(본문 누락 등) / 500(DB 오류 등) 모두 사용자에겐 같은 메시지로 노출
        // why: 구체 사유는 서버 로그에서 확인. 사용자에겐 의미 없는 정보.
        setError('로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } catch {
      // fetch 자체 실패 (네트워크 끊김 등)
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      // 성공 분기에선 이미 router.push로 페이지가 떠나지만,
      // push가 비동기라 짧은 시간 동안 버튼이 다시 활성화될 수 있어 finally에서 일괄 처리.
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-lg bg-white p-6 shadow"
      >
        <h1 className="text-xl font-bold">관리자 로그인</h1>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium">
            비밀번호
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            // autoComplete: 비밀번호 매니저가 인식하도록
            autoComplete="current-password"
            required
            className="w-full rounded border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          // 로딩 중에는 중복 제출 방지
          disabled={loading || password.length === 0}
          className="w-full rounded bg-neutral-900 py-2 text-white disabled:opacity-50"
        >
          {loading ? '확인 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
