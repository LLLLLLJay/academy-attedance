/**
 * /tablet/login — 키오스크 로그인 페이지
 *
 * 흐름:
 *   1. 비밀번호 입력 → POST /api/auth/tablet
 *   2. 200 → /tablet 으로 이동 (router.replace로 뒤로가기 시 로그인 화면 재노출 방지)
 *   3. 401 → "비밀번호 불일치"
 *   4. 429 → "잠시 후 다시 시도"
 *   5. 그 외 → 일반 오류
 *
 * UX 톤: /admin/login과 동일한 기본 폼 구조 + 키오스크 디자인 토큰(가로 화면, 큰 폰트/버튼).
 *        가로 1280×800 가정에서도 admin과 동일한 max-w 폼이면 충분히 크고, 키오스크 화면
 *        가운데에 자연스럽게 자리잡는다.
 */

'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function TabletLoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const router = useRouter();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/tablet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // why router.replace:
        //   학생이 키오스크 앞에서 뒤로가기 버튼을 눌러도 로그인 화면이 다시 뜨지 않게.
        //   admin은 push로 충분하지만 태블릿은 공용 기기라 history 오염을 더 보수적으로 다룬다.
        router.replace('/tablet');
        router.refresh();
        return;
      }

      if (res.status === 401) {
        setError('비밀번호가 일치하지 않습니다.');
      } else if (res.status === 429) {
        // brute-force 방어로 IP당 5회/분 제한 (lib/ratelimit.ts).
        setError('시도 횟수가 너무 많습니다. 잠시 후 다시 시도해주세요.');
      } else {
        // 400(본문 누락 등) / 500(tablet_password_hash 미설정 등) 모두 통합 메시지.
        setError('로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 shadow-xl"
      >
        <div className="flex flex-col items-center gap-3">
          <img
            src="/logo.png"
            alt="엘 영어학원 로고"
            className="h-28 w-auto object-contain"
          />
          <h1 className="text-2xl font-bold">키오스크 로그인</h1>
          <p className="text-sm text-neutral-500">
            선생님 비밀번호를 입력해주세요
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium">
            비밀번호
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            // 키오스크 터치 입력 친화 — 입력칸을 admin보다 살짝 크게.
            className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-lg outline-none focus:border-neutral-900"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || password.length === 0}
          className="w-full rounded-lg bg-neutral-900 py-3 text-lg font-medium text-white disabled:opacity-50"
        >
          {loading ? '확인 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
