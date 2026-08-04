import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const token = request.cookies.get('admin-token')?.value;
  const expectedToken = process.env.ADMIN_PASSWORD;

  // If no password configured, allow access (local dev)
  if (!expectedToken) {
    return NextResponse.next();
  }

  if (token !== expectedToken) {
    // For API routes, return 401
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // For admin page, redirect to login
    const loginUrl = new URL('/admin/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin', '/api/sessions/:path*'],
};
