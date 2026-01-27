'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/auth/supabase-client'

export default function VerifyPage() {
  const router = useRouter()
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(null)
  const [redirect, setRedirect] = useState('/spaces')
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    // Get phone and redirect from session storage
    const storedPhone = sessionStorage.getItem('verifyPhone')
    const storedRedirect = sessionStorage.getItem('verifyRedirect')

    if (!storedPhone) {
      // No phone stored, redirect to login
      router.push('/auth/login')
      return
    }

    setPhone(storedPhone)
    if (storedRedirect) {
      setRedirect(storedRedirect)
    }

    // Focus first input
    inputRefs.current[0]?.focus()
  }, [router])

  const handleChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1)

    const newCode = [...code]
    newCode[index] = digit
    setCode(newCode)

    // Auto-focus next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-submit when all digits entered
    if (digit && index === 5) {
      const fullCode = newCode.join('')
      if (fullCode.length === 6) {
        handleVerify(fullCode)
      }
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle backspace
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)

    if (pastedData.length === 6) {
      const newCode = pastedData.split('')
      setCode(newCode)
      handleVerify(pastedData)
    }
  }

  const handleVerify = async (verificationCode: string) => {
    if (!phone) return

    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: verificationCode,
        type: 'sms'
      })

      if (verifyError) {
        console.error('Verification error:', verifyError)
        setError(verifyError.message)
        setLoading(false)
        // Clear the code on error
        setCode(['', '', '', '', '', ''])
        inputRefs.current[0]?.focus()
        return
      }

      // Clear session storage
      sessionStorage.removeItem('verifyPhone')
      sessionStorage.removeItem('verifyRedirect')

      // Redirect to intended destination (default to /spaces if not set)
      router.push(redirect || '/spaces')
    } catch (err) {
      console.error('Unexpected error:', err)
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!phone) return

    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      const { error: resendError } = await supabase.auth.signInWithOtp({
        phone
      })

      if (resendError) {
        setError(resendError.message)
      } else {
        setError(null)
        // Show success message briefly
        setError('Code resent!')
        setTimeout(() => setError(null), 3000)
      }
    } catch (err) {
      setError('Failed to resend code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Format phone for display
  const formatPhone = (phoneNumber: string) => {
    const digits = phoneNumber.replace(/\D/g, '')
    if (digits.length === 11 && digits.startsWith('1')) {
      const areaCode = digits.slice(1, 4)
      const prefix = digits.slice(4, 7)
      const line = digits.slice(7, 11)
      return `(${areaCode}) ${prefix}-${line}`
    }
    return phoneNumber
  }

  if (!phone) {
    return null // Will redirect in useEffect
  }

  return (
    <div className="mt-8">
      <div className="text-center mb-6">
        <p className="text-sm text-[var(--text-secondary)]">
          Enter the 6-digit code sent to
        </p>
        <p className="text-lg font-medium text-[var(--text-on-dark)]">
          {formatPhone(phone)}
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); handleVerify(code.join('')) }} className="space-y-6">
        <div>
          <label className="sr-only">Verification code</label>
          <div className="flex justify-center space-x-2" onPaste={handlePaste}>
            {code.map((digit, index) => (
              <input
                key={index}
                ref={(el) => { inputRefs.current[index] = el }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="w-12 h-14 text-center text-xl font-semibold border border-[var(--text-meta)]/20 bg-[var(--bg-secondary)] text-[var(--text-on-dark)] rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--highlight-red)]/50 focus:border-[var(--highlight-red)]/50"
                disabled={loading}
              />
            ))}
          </div>
        </div>

        {error && (
          <div className={`rounded-md p-4 border ${error === 'Code resent!' ? 'bg-[rgba(59,124,150,0.15)] border-[var(--highlight-blue)]/30' : 'bg-[rgba(206,96,135,0.15)] border-[var(--highlight-red)]/30'}`}>
            <div className="flex justify-center">
              <p className={`text-sm font-medium ${error === 'Code resent!' ? 'text-[var(--highlight-blue)]' : 'text-[var(--highlight-red)]'}`}>
                {error}
              </p>
            </div>
          </div>
        )}

        <div>
          <button
            type="submit"
            disabled={loading || code.join('').length !== 6}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-[var(--text-on-dark)] bg-[var(--highlight-red)]/20 hover:bg-[var(--highlight-red)]/30 border-[var(--highlight-red)]/40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--highlight-red)]/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={handleResend}
            disabled={loading}
            className="text-sm text-[var(--highlight-blue)] hover:text-[var(--highlight-blue)]/80 disabled:opacity-50"
          >
            Didn&apos;t receive a code? Resend
          </button>
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={() => router.push('/auth/login')}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-on-dark)]"
          >
            Use a different phone number
          </button>
        </div>
      </form>
    </div>
  )
}
