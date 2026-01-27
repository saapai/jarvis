'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import type { AppUser } from '@/lib/auth/user'

interface UserMenuProps {
  user: AppUser
}

export function UserMenu({ user }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Format phone for display
  const formatPhone = (phone: string) => {
    if (phone.length === 10) {
      return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`
    }
    return phone
  }

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 text-sm text-[var(--text-on-dark)] hover:text-[var(--text-on-dark)] focus:outline-none"
      >
        <div className="w-8 h-8 rounded-full bg-[var(--highlight-red)]/20 border border-[var(--highlight-red)]/40 flex items-center justify-center">
          <span className="text-[var(--highlight-red)] font-medium">
            {user.name ? user.name.charAt(0).toUpperCase() : user.phoneNumber.charAt(0)}
          </span>
        </div>
        <span className="hidden sm:block">
          {user.name || formatPhone(user.phoneNumber)}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-[var(--card-bg)] rounded-md shadow-[inset_0_1px_0_rgba(0,0,0,0.15),0_2px_8px_rgba(0,0,0,0.08)] py-1 z-10 border border-[var(--card-border)]">
          <div className="px-4 py-2 border-b border-[var(--card-border)]">
            <p className="text-sm font-medium text-[var(--text-on-card-title)]">{user.name || 'User'}</p>
            <p className="text-xs text-[var(--text-meta)]">{formatPhone(user.phoneNumber)}</p>
          </div>

          <Link
            href="/spaces"
            onClick={() => setIsOpen(false)}
            className="block px-4 py-2 text-sm text-[var(--text-on-card-title)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            All Spaces
          </Link>

          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="w-full text-left px-4 py-2 text-sm text-[var(--text-on-card-title)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
