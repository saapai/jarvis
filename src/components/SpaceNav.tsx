'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface SpaceNavProps {
  slug: string
  isAdmin: boolean
}

export function SpaceNav({ slug, isAdmin }: SpaceNavProps) {
  const pathname = usePathname()

  const tabs = [
    { name: 'Inbox', href: `/spaces/${slug}/inbox`, icon: InboxIcon },
    { name: 'Chat', href: `/spaces/${slug}/chat`, icon: ChatUploadIcon },
    { name: 'Announcements', href: `/spaces/${slug}/announcements`, icon: MegaphoneIcon },
    { name: 'Settings', href: `/spaces/${slug}/settings`, icon: SettingsIcon },
  ]

  return (
    <nav className="-mb-px flex items-center space-x-6 overflow-x-auto" aria-label="Tabs">
      <Link 
        href="/spaces" 
        className="flex items-center text-[var(--text-meta)] hover:text-[var(--text-on-dark)] transition-colors py-4"
        title="Back to spaces"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </Link>
      {tabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/')
        return (
          <Link
            key={tab.name}
            href={tab.href}
            className={`
              flex items-center whitespace-nowrap py-4 px-1 border-b-2 transition-colors
              ${isActive
                ? 'border-[var(--highlight-red)]'
                : 'border-transparent hover:border-[var(--text-meta)]/30'
              }
            `}
            title={tab.name}
          >
            <tab.icon className={`w-5 h-5 ${isActive ? 'text-[var(--highlight-red)]' : 'text-[var(--text-meta)] hover:text-[var(--text-on-dark)]'}`} />
          </Link>
        )
      })}
    </nav>
  )
}

// Icon components
function InboxIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
    </svg>
  )
}

function ChatUploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {/* Chat bubble */}
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 10c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 18l1.395-3.72C3.512 13.042 3 11.574 3 10c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      {/* Upload arrow in top right */}
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
    </svg>
  )
}

function MegaphoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}
