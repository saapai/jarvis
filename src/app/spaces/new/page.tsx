'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewSpacePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-generate join code from name
  const handleNameChange = (value: string) => {
    setName(value)
    // Generate a simple join code from the name
    const code = value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8)
    setJoinCode(code)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (!name.trim()) {
      setError('Please enter a space name')
      setLoading(false)
      return
    }

    if (!joinCode.trim() || joinCode.length < 2) {
      setError('Join code must be at least 2 characters')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/spaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          joinCode: joinCode.toUpperCase().trim()
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to create space')
        setLoading(false)
        return
      }

      // Redirect to the new space
      router.push(`/spaces/${data.slug}`)
    } catch (err) {
      console.error('Error creating space:', err)
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-main)]">
      {/* Header */}
      <header className="bg-[var(--bg-secondary)] border-b border-[var(--text-meta)]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center py-4">
            <Link href="/spaces" className="text-[var(--text-meta)] hover:text-[var(--text-on-dark)] mr-4">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-[var(--text-on-dark)]">Create New Space</h1>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-[var(--card-bg)] rounded-lg shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] border border-[var(--card-border)] p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-[var(--text-on-dark)]">
                Space Name
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="My Community"
                className="mt-1 block w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--text-meta)]/20 rounded-md shadow-sm text-[var(--text-on-dark)] placeholder-[var(--text-meta)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--highlight-red)]/50 focus:border-[var(--highlight-red)]/50 sm:text-sm"
                required
              />
            </div>

            <div>
              <label htmlFor="joinCode" className="block text-sm font-medium text-[var(--text-on-dark)]">
                Join Code
              </label>
              <div className="mt-1 relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[var(--text-meta)]">
                  JOIN
                </span>
                <input
                  type="text"
                  id="joinCode"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                  placeholder="MYSPACE"
                  maxLength={8}
                  className="block w-full pl-14 px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--text-meta)]/20 rounded-md shadow-sm text-[var(--text-on-dark)] placeholder-[var(--text-meta)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--highlight-red)]/50 focus:border-[var(--highlight-red)]/50 sm:text-sm font-mono uppercase"
                  required
                />
              </div>
              <p className="mt-2 text-sm text-[var(--text-meta)]">
                Members can text &quot;JOIN {joinCode || 'CODE'}&quot; to join this space via SMS
              </p>
            </div>

            {error && (
              <div className="rounded-md bg-[rgba(206,96,135,0.15)] border border-[var(--highlight-red)]/30 p-4">
                <p className="text-sm text-[var(--highlight-red)]">{error}</p>
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <Link
                href="/spaces"
                className="px-4 py-2 border border-[var(--text-meta)]/20 rounded-md text-sm font-medium text-[var(--text-on-dark)] hover:bg-[var(--bg-hover)] transition-all"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 border border-[var(--highlight-red)]/40 rounded-md shadow-sm text-sm font-medium text-[var(--text-on-dark)] bg-[var(--highlight-red)]/20 hover:bg-[var(--highlight-red)]/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--highlight-red)]/50 disabled:opacity-50 transition-all"
              >
                {loading ? 'Creating...' : 'Create Space'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
