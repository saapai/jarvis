/**
 * Server-side Supabase client
 * Use this in Server Components, Route Handlers, and Server Actions
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

/**
 * Get the current authenticated user
 * Returns null if not authenticated
 */
export async function getUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  return user
}

/**
 * Get the current session
 * Returns null if no active session
 */
export async function getSession() {
  const supabase = await createClient()
  const { data: { session }, error } = await supabase.auth.getSession()

  if (error || !session) {
    return null
  }

  return session
}

/**
 * Require authentication - redirects to login if not authenticated
 * Use this at the top of protected pages
 * Returns the authenticated user (never null since we redirect)
 */
export async function requireAuth() {
  const user = await getUser()

  if (!user) {
    const { redirect } = await import('next/navigation')
    redirect('/auth/login')
  }

  // TypeScript doesn't know redirect() never returns, so we need to help it
  return user!
}
