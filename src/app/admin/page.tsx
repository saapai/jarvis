'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// SMS conversations, read LIVE from the canvas (Duttapad) pipeline via the
// cached /api/admin/canvas-conversations proxy — canvas is the source of truth
// and keeps receiving messages, so reading it live means /admin is never behind
// (a DB snapshot would lag). The 120s server-side cache keeps loads fast.
// The list endpoint returns summaries; full threads load lazily per phone and
// are cached client-side so switching between conversations never refetches.

interface ConvoSummary {
  phone_normalized: string
  last_message: string | null
  last_message_at: string
  member_name: string | null
  total_count: number
}

interface ThreadMessage {
  id: string
  direction: 'inbound' | 'outbound'
  text: string
  meta: any
  created_at: string
}

interface Thread {
  phone: string
  name: string | null
  messages: ThreadMessage[]
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

// Canvas may return meta as a JSON string or an already-parsed object.
function metaAction(meta: any): string | null {
  if (!meta) return null
  try {
    const obj = typeof meta === 'string' ? JSON.parse(meta) : meta
    return obj?.action || null
  } catch {
    return null
  }
}

export default function AdminPage() {
  const [conversations, setConversations] = useState<ConvoSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const threadCache = useRef<Map<string, Thread>>(new Map())
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/admin/canvas-conversations')
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

  const openConversation = useCallback(async (phone: string) => {
    setSelectedPhone(phone)

    const cached = threadCache.current.get(phone)
    if (cached) {
      setThread(cached)
      return
    }

    setThread(null)
    setThreadLoading(true)
    try {
      const res = await fetch(`/api/admin/canvas-conversations/${encodeURIComponent(phone)}`)
      if (!res.ok) throw new Error(`${res.status}`)
      const data: Thread = await res.json()
      threadCache.current.set(phone, data)
      setThread(data)
    } catch (err) {
      console.error('Failed to load conversation:', err)
      setThread({ phone, name: null, messages: [] })
    } finally {
      setThreadLoading(false)
    }
  }, [])

  // Newest message sits at the bottom — jump there whenever a thread renders.
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [thread])

  const filtered = conversations.filter(conv => {
    const q = searchQuery.toLowerCase()
    return (
      (conv.member_name || '').toLowerCase().includes(q) ||
      conv.phone_normalized.includes(searchQuery)
    )
  })

  const selectedSummary = conversations.find(c => c.phone_normalized === selectedPhone)
  const headerName =
    thread?.name || selectedSummary?.member_name || (selectedPhone ? formatPhone(selectedPhone) : '')

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
            <div className="empty">couldn&apos;t reach canvas — refresh to retry</div>
          ) : filtered.length === 0 ? (
            <div className="empty">no conversations</div>
          ) : (
            filtered.map(conv => (
              <button
                key={conv.phone_normalized}
                onClick={() => openConversation(conv.phone_normalized)}
                className={`convo-item ${selectedPhone === conv.phone_normalized ? 'active' : ''}`}
              >
                <span className="convo-name">
                  {conv.member_name || formatPhone(conv.phone_normalized)}
                </span>
                <span className="convo-time">{relativeTime(conv.last_message_at)}</span>
                <span className="convo-phone">{formatPhone(conv.phone_normalized)}</span>
                <span className="convo-count">{conv.total_count} msgs</span>
                {conv.last_message && <p className="convo-preview">{conv.last_message}</p>}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Thread panel */}
      <main className="thread-panel">
        {selectedPhone ? (
          <>
            <div className="thread-header">
              <p className="eyebrow">thread</p>
              <h2>{headerName}</h2>
              <span className="thread-phone">{formatPhone(selectedPhone)}</span>
            </div>

            <div ref={messagesRef} className="thread-messages">
              {threadLoading ? (
                <div className="empty">loading…</div>
              ) : !thread || thread.messages.length === 0 ? (
                <div className="empty">no messages</div>
              ) : (
                <div className="thread-inner">
                  {thread.messages.map(msg => (
                    <div key={msg.id} className={`msg ${msg.direction === 'outbound' ? 'out' : 'in'}`}>
                      <div className="bubble">
                        <p>{msg.text}</p>
                      </div>
                      <span className="msg-meta">
                        {formatTimestamp(msg.created_at)}
                        {metaAction(msg.meta) && <span className="action"> · {metaAction(msg.meta)}</span>}
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
