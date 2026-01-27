'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/auth/supabase-client'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/spaces'

  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Format phone number as user types
  const formatPhoneNumber = (value: string) => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '')

    // Format as (XXX) XXX-XXXX
    if (digits.length <= 3) {
      return digits
    } else if (digits.length <= 6) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
    } else {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`
    }
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value
    
    // Remove any existing +1 prefix if user types it
    if (value.startsWith('+1')) {
      value = value.slice(2)
    }
    if (value.startsWith('1') && value.length > 10) {
      value = value.slice(1)
    }
    
    const formatted = formatPhoneNumber(value)
    setPhone(formatted)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Extract just the digits
    let digits = phone.replace(/\D/g, '')

    // Remove leading 1 if present (US country code)
    if (digits.length === 11 && digits.startsWith('1')) {
      digits = digits.slice(1)
    }

    if (digits.length !== 10) {
      setError('Please enter a valid 10-digit phone number')
      setLoading(false)
      return
    }

    try {
      const supabase = createClient()

      // Format for E.164 (required by Supabase) - always add +1 for US numbers
      const e164Phone = `+1${digits}`
      
      console.log('[Login] Sending OTP to:', e164Phone)

      const { error: signInError } = await supabase.auth.signInWithOtp({
        phone: e164Phone,
        options: {
          // Store redirect URL in session storage for after verification
          data: {
            redirect
          }
        }
      })

      if (signInError) {
        console.error('Sign in error:', signInError)
        
        // Provide more helpful error messages
        if (signInError.message.includes('Invalid API key') || signInError.message.includes('API key')) {
          setError('Supabase API key is missing or invalid. Please check your environment variables.')
        } else if (signInError.message.includes('Unsupported phone provider')) {
          setError('Phone authentication is not enabled for this provider. Please check your Supabase project settings or contact support.')
        } else {
          setError(signInError.message)
        }
        setLoading(false)
        return
      }

      // Store phone and redirect for verification page
      sessionStorage.setItem('verifyPhone', e164Phone)
      sessionStorage.setItem('verifyRedirect', redirect)

      // Navigate to verification page
      router.push('/auth/verify')
    } catch (err: any) {
      console.error('Unexpected error:', err)
      
      // Check if it's the missing env vars error
      if (err?.message?.includes('Missing Supabase environment variables')) {
        setError('Supabase is not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment variables.')
      } else {
        setError('Something went wrong. Please try again.')
      }
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-[var(--text-on-dark)]">
          Phone Number
        </label>
        <div className="mt-1">
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            value={phone}
            onChange={handlePhoneChange}
            placeholder="(555) 555-5555"
            className="appearance-none block w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--text-meta)]/20 rounded-md shadow-sm placeholder-[var(--text-meta)]/50 text-[var(--text-on-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--highlight-red)]/50 focus:border-[var(--highlight-red)]/50 sm:text-sm"
          />
        </div>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          We&apos;ll send you a verification code via SMS
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-[rgba(206,96,135,0.15)] border border-[var(--highlight-red)]/30 p-4">
          <div className="flex">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-[var(--highlight-red)]">{error}</h3>
            </div>
          </div>
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={loading}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-[var(--text-on-dark)] bg-[var(--highlight-red)]/20 hover:bg-[var(--highlight-red)]/30 border-[var(--highlight-red)]/40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--highlight-red)]/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {loading ? 'Sending code...' : 'Send verification code'}
        </button>
      </div>
    </form>
  )
}

function LoginFormFallback() {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-[var(--text-on-dark)]">
          Phone Number
        </label>
        <div className="mt-1">
          <div className="h-10 bg-[var(--bg-secondary)] rounded-md animate-pulse" />
        </div>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          We&apos;ll send you a verification code via SMS
        </p>
      </div>
      <div>
        <div className="h-10 bg-[var(--bg-secondary)] rounded-md animate-pulse" />
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="mt-8">
      <Suspense fallback={<LoginFormFallback />}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
