import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = pathname.startsWith('/login');
  const token = request.cookies.get('ai_trackster_session');

  if (!token && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Exclude any path with a file extension (icon.png, apple-icon.png, ai-trackster-logo.png,
  // dll) selain _next/* — kalau nggak, request asset publik ikut ke-redirect ke /login buat
  // visitor yang belum login, jadi logo/favicon rusak di halaman login.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
