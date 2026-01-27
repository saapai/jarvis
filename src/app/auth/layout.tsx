import type { Metadata } from 'next'

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
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Jarvis</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your SMS communication platform
          </p>
        </div>
        {children}
      </div>
    </div>
  )
}
