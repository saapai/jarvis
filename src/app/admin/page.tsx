'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import './admin.css'

// SMS conversations, sourced live from the canvas (Duttapad) pipeline via the
// cached /api/admin/canvas-conversations proxy. The list endpoint returns only
// summaries; full threads load lazily per phone and are kept in a client-side
// cache so switching between conversations never refetches.

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
  if (/^\d{10}$/.test(phone)) {
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`
  }
  return phone
}

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(dateStr: string): string {
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

  // Newest messages sit at the bottom — jump there whenever a thread renders
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [thread])

  const filteredConversations = conversations.filter(conv => {
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
          <h1>
            conversations<span className="accent">_</span>
          </h1>
          <p className="subtle">live from duttapad sms</p>
          <input
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
          ) : filteredConversations.length === 0 ? (
            <div className="empty">no conversations</div>
          ) : (
            filteredConversations.map(conv => (
              <button
                key={conv.phone_normalized}
                onClick={() => openConversation(conv.phone_normalized)}
                className={`convo-item ${selectedPhone === conv.phone_normalized ? 'active' : ''}`}
              >
                <div className="convo-row">
                  <span className="convo-name">
                    {conv.member_name || formatPhone(conv.phone_normalized)}
                  </span>
                  <span className="convo-time">{relativeTime(conv.last_message_at)}</span>
                </div>
                <div className="convo-row">
                  <span className="convo-phone">{formatPhone(conv.phone_normalized)}</span>
                  <span className="convo-count">{conv.total_count}</span>
                </div>
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
              <h2>{headerName}</h2>
              <p className="subtle">{formatPhone(selectedPhone)}</p>
            </div>

            <div ref={messagesRef} className="thread-messages">
              {threadLoading ? (
                <div className="empty">loading…</div>
              ) : !thread || thread.messages.length === 0 ? (
                <div className="empty">no messages</div>
              ) : (
                thread.messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`bubble-row ${msg.direction === 'outbound' ? 'out' : 'in'}`}
                  >
                    <div className="bubble-col">
                      <div className="bubble">
                        <p>{msg.text}</p>
                      </div>
                      <span className="bubble-time">{formatTime(msg.created_at)}</span>
                    </div>
                  </div>
                ))
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
