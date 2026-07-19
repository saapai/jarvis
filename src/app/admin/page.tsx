'use client'

import { useState, useEffect, useRef } from 'react'

// SMS conversations, read from the Jarvis database (/api/admin/conversations),
// which holds the full history including the canvas backfill. Each conversation
// arrives with its complete message list (oldest first), so switching threads is
// instant and we scroll to the newest message at the bottom on open.

interface Message {
  id: string
  direction: 'inbound' | 'outbound'
  text: string
  meta: any
  createdAt: string
}

interface Conversation {
  id: string
  name: string
  phone: string
  optedOut: boolean
  messageCount: number
  messages: Message[]
  lastMessage?: string
  lastMessageAt: string | null
}

function formatPhone(phone: string): string {
  const d = (phone || '').replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

export default function AdminPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/admin/conversations')
      .then(res => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.json()
      })
      .then(data => setConversations(data.conversations || []))
      .catch(err => {
        console.error('Failed to load conversations:', err)
        setLoadError(true)
      })
      .finally(() => setLoading(false))
  }, [])

  // Newest message sits at the bottom — jump there whenever a thread opens.
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [selected])

  const filtered = conversations.filter(conv => {
    const q = searchQuery.toLowerCase()
    return conv.name.toLowerCase().includes(q) || conv.phone.includes(searchQuery)
  })

  return (
    <div className="admin-root">
      {/* Sidebar — conversation list */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <p className="eyebrow">conversations · sms</p>
          <h1>
            the register
            {!loading && <span className="count">{conversations.length}</span>}
          </h1>
          <input
            className="search"
            type="text"
            placeholder="search name or number"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="convo-list">
          {loading ? (
            <div className="empty">loading…</div>
          ) : loadError ? (
            <div className="empty">couldn&apos;t load — refresh to retry</div>
          ) : filtered.length === 0 ? (
            <div className="empty">no conversations</div>
          ) : (
            filtered.map(conv => (
              <button
                key={conv.id}
                onClick={() => setSelected(conv)}
                className={`convo-item ${selected?.id === conv.id ? 'active' : ''}`}
              >
                <span className="convo-name">{conv.name}</span>
                <span className="convo-time">{relativeTime(conv.lastMessageAt)}</span>
                <span className="convo-phone">{formatPhone(conv.phone)}</span>
                <span className="convo-count">{conv.messageCount} msgs</span>
                {(conv.lastMessage || conv.messages[conv.messages.length - 1]?.text) && (
                  <p className="convo-preview">
                    {conv.lastMessage || conv.messages[conv.messages.length - 1]?.text}
                  </p>
                )}
                {conv.optedOut && <span className="convo-optout">opted out</span>}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Thread panel */}
      <main className="thread-panel">
        {selected ? (
          <>
            <div className="thread-header">
              <p className="eyebrow">thread</p>
              <h2>{selected.name}</h2>
              <span className="thread-phone">{formatPhone(selected.phone)}</span>
            </div>

            <div ref={messagesRef} className="thread-messages">
              {selected.messages.length === 0 ? (
                <div className="empty">no messages</div>
              ) : (
                <div className="thread-inner">
                  {selected.messages.map(msg => (
                    <div key={msg.id} className={`msg ${msg.direction === 'outbound' ? 'out' : 'in'}`}>
                      <div className="bubble">
                        <p>{msg.text}</p>
                      </div>
                      <span className="msg-meta">
                        {formatTimestamp(msg.createdAt)}
                        {msg.meta?.action && <span className="action"> · {msg.meta.action}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty full">select a conversation</div>
        )}
      </main>
    </div>
  )
}
