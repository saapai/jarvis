import type { Metadata } from 'next'
import '../globals.css'

export const metadata: Metadata = {
  title: 'Sign In - Jarvis',
  description: 'Sign in to Jarvis with your phone number',
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg-main)] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-[var(--text-on-dark)]">jarvis</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Your SMS communication platform
          </p>
        </div>
        {children}
      </div>
    </div>
  )
}
