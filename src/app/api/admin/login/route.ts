export async function POST(request: Request) {
  const { password } = await request.json();
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return Response.json({ error: 'ADMIN_PASSWORD not configured' }, { status: 500 });
  }

  if (password !== expected) {
    return Response.json({ error: 'Wrong password' }, { status: 401 });
  }

  const response = Response.json({ ok: true });
  // Set cookie — httpOnly, secure in production, 24h expiry
  const isSecure = process.env.NODE_ENV === 'production';
  const cookie = `admin-token=${expected}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${isSecure ? '; Secure' : ''}`;
  response.headers.set('Set-Cookie', cookie);

  return response;
}
