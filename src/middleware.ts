import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // If Supabase is not configured, allow public routes only
  if (!url || !key) {
    const { pathname } = request.nextUrl
    const publicRoutes = ['/auth/login', '/auth/verify', '/auth/callback']
    if (!publicRoutes.some(route => pathname.startsWith(route))) {
      return NextResponse.redirect(new URL('/auth/login?error=supabase_not_configured', request.url))
    }
    return response
  }

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the auth token
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public routes that don't require authentication
  const publicRoutes = ['/auth/login', '/auth/verify', '/auth/callback', '/api/twilio']
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))

  // API routes (except twilio) should handle their own auth
  const isApiRoute = pathname.startsWith('/api/') && !pathname.startsWith('/api/twilio')

  // Static files and Next.js internals
  const isStaticOrInternal = pathname.startsWith('/_next') ||
                             pathname.startsWith('/favicon') ||
                             pathname.includes('.')

  // Allow public routes, static files, and API routes
  if (isPublicRoute || isStaticOrInternal || isApiRoute) {
    return response
  }

  // Redirect unauthenticated users to login
  if (!user) {
    const redirectUrl = new URL('/auth/login', request.url)
    // Preserve the intended destination
    if (pathname !== '/') {
      redirectUrl.searchParams.set('redirect', pathname)
    }
    return NextResponse.redirect(redirectUrl)
  }

  // Redirect authenticated users from root to spaces
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/spaces', request.url))
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
