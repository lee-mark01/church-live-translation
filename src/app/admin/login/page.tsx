'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push('/admin');
      } else {
        setError('비밀번호가 틀렸습니다.');
      }
    } catch {
      setError('서버 연결에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h1 className="text-lg font-bold">Admin Login</h1>
        <p className="text-xs text-zinc-400">관리자 비밀번호를 입력하세요.</p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          autoFocus
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800"
        />

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
