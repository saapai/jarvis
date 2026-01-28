'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Space {
  id: string
  name: string
  slug: string
  joinCode: string
  airtableBaseId: string | null
  airtableTableName: string | null
}

interface SpaceSettingsFormProps {
  space: Space
}

export function SpaceSettingsForm({ space }: SpaceSettingsFormProps) {
  const router = useRouter()
  const [name, setName] = useState(space.name)
  const [joinCode, setJoinCode] = useState(space.joinCode)
  const [airtableBaseId, setAirtableBaseId] = useState(space.airtableBaseId || '')
  const [airtableTableName, setAirtableTableName] = useState(space.airtableTableName || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch(`/api/spaces/${space.slug}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          joinCode: joinCode.toUpperCase(),
          airtableBaseId: airtableBaseId || null,
          airtableTableName: airtableTableName || null
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to update settings')
        setLoading(false)
        return
      }

      setSuccess(true)

      // If slug changed, redirect to new URL
      if (data.slug !== space.slug) {
        router.push(`/spaces/${data.slug}/settings`)
      } else {
        router.refresh()
      }
    } catch (err) {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] p-6 space-y-6">
      {/* Basic Settings */}
      <div>
        <h3 className="text-sm font-medium text-[var(--text-on-card-title)] mb-4">Basic Settings</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-[var(--text-on-card)]">
              Space Name
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 block w-full px-3 py-2 bg-[var(--bg-main)] border border-[var(--card-border)] rounded-md text-[var(--text-on-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--highlight-red)]/30 focus:border-[var(--highlight-red)]/40 sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="joinCode" className="block text-sm font-medium text-[var(--text-on-card)]">
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
                required
                maxLength={8}
                className="block w-full pl-14 px-3 py-2 bg-[var(--bg-main)] border border-[var(--card-border)] rounded-md text-[var(--text-on-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--highlight-red)]/30 focus:border-[var(--highlight-red)]/40 sm:text-sm font-mono uppercase"
              />
            </div>
            <p className="mt-1 text-xs text-[var(--text-meta)]">
              Members text &quot;JOIN {joinCode}&quot; to join via SMS
            </p>
          </div>
        </div>
      </div>

      {/* Airtable Integration */}
      <div className="border-t border-[var(--card-border)] pt-6">
        <h3 className="text-sm font-medium text-[var(--text-on-card-title)] mb-2">Airtable Integration (Optional)</h3>
        <p className="text-sm text-[var(--text-meta)] mb-4">
          Connect to Airtable to sync member data and poll responses with an existing table.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="airtableBaseId" className="block text-sm font-medium text-[var(--text-on-card)]">
              Airtable Base ID
            </label>
            <input
              type="text"
              id="airtableBaseId"
              value={airtableBaseId}
              onChange={(e) => setAirtableBaseId(e.target.value)}
              placeholder="appXXXXXXXXXXXXXX"
              className="mt-1 block w-full px-3 py-2 bg-[var(--bg-main)] border border-[var(--card-border)] rounded-md text-[var(--text-on-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--highlight-red)]/30 focus:border-[var(--highlight-red)]/40 sm:text-sm font-mono"
            />
          </div>

          <div>
            <label htmlFor="airtableTableName" className="block text-sm font-medium text-[var(--text-on-card)]">
              Table Name
            </label>
            <input
              type="text"
              id="airtableTableName"
              value={airtableTableName}
              onChange={(e) => setAirtableTableName(e.target.value)}
              placeholder="Members"
              className="mt-1 block w-full px-3 py-2 bg-[var(--bg-main)] border border-[var(--card-border)] rounded-md text-[var(--text-on-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--highlight-red)]/30 focus:border-[var(--highlight-red)]/40 sm:text-sm"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-[rgba(206,96,135,0.15)] border border-[var(--highlight-red)]/30 p-4">
          <p className="text-sm text-[var(--highlight-red)]">{error}</p>
        </div>
      )}

      {success && (
        <div className="rounded-md bg-[rgba(59,124,150,0.15)] border border-[var(--highlight-blue)]/30 p-4">
          <p className="text-sm text-[var(--highlight-blue)]">Settings saved successfully!</p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-[var(--text-on-dark)] bg-[var(--highlight-red)] hover:bg-[var(--highlight-red)]/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--highlight-red)]/50 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </form>
  )
}
