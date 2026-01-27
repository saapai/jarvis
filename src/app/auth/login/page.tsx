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
    const formatted = formatPhoneNumber(e.target.value)
    setPhone(formatted)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Extract just the digits
    const digits = phone.replace(/\D/g, '')

    if (digits.length !== 10) {
      setError('Please enter a valid 10-digit phone number')
      setLoading(false)
      return
    }

    try {
      const supabase = createClient()

      // Format for E.164 (required by Supabase)
      const e164Phone = `+1${digits}`

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
        setError(signInError.message)
        setLoading(false)
        return
      }

      // Store phone and redirect for verification page
      sessionStorage.setItem('verifyPhone', e164Phone)
      sessionStorage.setItem('verifyRedirect', redirect)

      // Navigate to verification page
      router.push('/auth/verify')
    } catch (err) {
      console.error('Unexpected error:', err)
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
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
            className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>
        <p className="mt-2 text-sm text-gray-500">
          We&apos;ll send you a verification code via SMS
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <div className="flex">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">{error}</h3>
            </div>
          </div>
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={loading}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
        <label className="block text-sm font-medium text-gray-700">
          Phone Number
        </label>
        <div className="mt-1">
          <div className="h-10 bg-gray-100 rounded-md animate-pulse" />
        </div>
        <p className="mt-2 text-sm text-gray-500">
          We&apos;ll send you a verification code via SMS
        </p>
      </div>
      <div>
        <div className="h-10 bg-gray-200 rounded-md animate-pulse" />
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
