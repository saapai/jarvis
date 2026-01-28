'use client'

import { useState } from 'react'

interface Member {
  id: string
  userId: string
  name: string | null
  user: {
    name: string | null
    phoneNumber: string
  }
  role: string
  optedOut: boolean
  joinedAt: Date
}

interface MembersSectionProps {
  members: Member[]
  currentUserId: string
  spaceSlug: string
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(date))
}

function formatPhone(phone: string) {
  if (phone.length === 10) {
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`
  }
  return phone
}

export function MembersSection({ members, currentUserId, spaceSlug }: MembersSectionProps) {
  const [updating, setUpdating] = useState<Record<string, boolean>>({})

  const handleRoleToggle = async (memberId: string, currentRole: string) => {
    if (updating[memberId]) return

    const newRole = currentRole === 'admin' ? 'member' : 'admin'
    setUpdating(prev => ({ ...prev, [memberId]: true }))

    try {
      const response = await fetch(`/api/spaces/${spaceSlug}/members/${memberId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: newRole }),
      })

      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to update role')
        return
      }

      window.location.reload()
    } catch (error) {
      console.error('Error updating role:', error)
      alert('Failed to update role')
    } finally {
      setUpdating(prev => ({ ...prev, [memberId]: false }))
    }
  }

  const roleOrder = { owner: 0, admin: 1, member: 2 }
  const sortedMembers = [...members].sort((a, b) =>
    (roleOrder[a.role as keyof typeof roleOrder] || 2) - (roleOrder[b.role as keyof typeof roleOrder] || 2)
  )

  return (
    <div className="bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] overflow-hidden">
      <ul className="divide-y divide-[var(--card-border)]">
        {sortedMembers.map((member) => {
          const isCurrentUser = member.userId === currentUserId
          const canToggle = !isCurrentUser && member.role !== 'owner'
          const displayName = member.name || member.user.name || 'Unknown'

          return (
            <li key={member.id} className="px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-10 h-10 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mr-4 border border-[var(--card-border)]">
                    <span className="text-[var(--text-on-dark)] font-medium">
                      {displayName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--text-on-card-title)]">
                      {displayName}
                      {isCurrentUser && (
                        <span className="ml-2 text-xs text-[var(--text-meta)]">(you)</span>
                      )}
                    </p>
                    <p className="text-xs text-[var(--text-meta)]">
                      {formatPhone(member.user.phoneNumber)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    member.role === 'owner'
                      ? 'bg-[rgba(206,96,135,0.2)] text-[var(--highlight-red)] border border-[var(--highlight-red)]/30'
                      : member.role === 'admin'
                      ? 'bg-[rgba(59,124,150,0.2)] text-[var(--highlight-blue)] border border-[var(--highlight-blue)]/30'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-meta)] border border-[var(--card-border)]'
                  }`}>
                    {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                  </span>
                  {canToggle && (
                    <button
                      onClick={() => handleRoleToggle(member.id, member.role)}
                      disabled={updating[member.id]}
                      className="text-xs text-[var(--text-meta)] hover:text-[var(--text-on-dark)] transition-colors disabled:opacity-50"
                    >
                      {updating[member.id] ? '...' : member.role === 'admin' ? 'Make Member' : 'Make Admin'}
                    </button>
                  )}
                  {member.optedOut && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[rgba(206,96,135,0.15)] text-[var(--highlight-red)] border border-[var(--highlight-red)]/20">
                      Opted out
                    </span>
                  )}
                  <span className="text-xs text-[var(--text-meta)]">
                    Joined {formatDate(member.joinedAt)}
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
