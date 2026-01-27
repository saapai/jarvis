'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Invite {
  id: string
  code: string
  expiresAt: Date | null
  maxUses: number | null
  uses: number
  createdAt: Date
}

interface InviteLinkSectionProps {
  spaceId: string
  slug: string
  existingInvites: Invite[]
}

export function InviteLinkSection({ spaceId, slug, existingInvites }: InviteLinkSectionProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCreateInvite = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/spaces/${slug}/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to create invite')
        setLoading(false)
        return
      }

      router.refresh()
    } catch (err) {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteInvite = async (inviteId: string) => {
    try {
      const response = await fetch(`/api/spaces/${slug}/invites/${inviteId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to delete invite')
        return
      }

      router.refresh()
    } catch (err) {
      setError('Something went wrong. Please try again.')
    }
  }

  const copyToClipboard = async (code: string, inviteId: string) => {
    const url = `${window.location.origin}/invite/${code}`
    await navigator.clipboard.writeText(url)
    setCopiedId(inviteId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(date))
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Invite Links</h3>
          <p className="text-sm text-gray-500">
            Share these links to invite new members
          </p>
        </div>
        <button
          onClick={handleCreateInvite}
          disabled={loading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Invite Link'}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {existingInvites.length === 0 ? (
        <div className="text-center py-8 bg-white rounded-lg shadow">
          <svg
            className="mx-auto h-10 w-10 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
          <p className="mt-2 text-sm text-gray-500">No invite links yet</p>
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden rounded-lg">
          <ul className="divide-y divide-gray-200">
            {existingInvites.map((invite) => (
              <li key={invite.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                        /invite/{invite.code}
                      </code>
                      <button
                        onClick={() => copyToClipboard(invite.code, invite.id)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        {copiedId === invite.id ? 'Copied!' : 'Copy link'}
                      </button>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Created {formatDate(invite.createdAt)}
                      {invite.maxUses && ` · ${invite.uses}/${invite.maxUses} uses`}
                      {invite.expiresAt && ` · Expires ${formatDate(invite.expiresAt)}`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteInvite(invite.id)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
