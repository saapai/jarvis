'use client'

import { useState, useEffect } from 'react'

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
  lastMessageAt: string | null
}

export default function AdminPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    fetch('/api/admin/conversations')
      .then(res => res.json())
      .then(data => {
        setConversations(data.conversations || [])
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load conversations:', err)
        setLoading(false)
      })
  }, [])

  const filteredConversations = conversations.filter(conv =>
    conv.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.phone.includes(searchQuery)
  )

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

  return (
    <div className="min-h-screen bg-[#f5f1e8] flex">
      {/* Sidebar - List of conversations */}
      <div className="w-80 border-r border-gray-300 bg-white flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-300">
          <h1 className="text-xl font-bold text-gray-900 mb-3">
            Admin<span className="text-red-500">_</span>
          </h1>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 text-sm"
          />
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500">Loading...</div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500">No conversations</div>
          ) : (
            filteredConversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => setSelectedConversation(conv)}
                className={`w-full p-4 border-b border-gray-200 text-left transition-colors ${
                  selectedConversation?.id === conv.id
                    ? 'bg-red-50 border-l-4 border-l-red-500'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-900">{conv.name}</span>
                  {conv.lastMessageAt && (
                    <span className="text-xs text-gray-500">
                      {formatDate(conv.lastMessageAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{conv.phone}</span>
                  <span className="text-xs text-gray-500">
                    {conv.messageCount} msgs
                  </span>
                </div>
                {conv.optedOut && (
                  <span className="inline-block mt-1 text-xs text-red-600 font-mono">
                    opted out
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Content - Selected conversation */}
      <div className="flex-1 flex flex-col bg-[#f5f1e8]">
        {selectedConversation ? (
          <>
            {/* Header */}
            <div className="p-4 bg-white border-b border-gray-300">
              <h2 className="text-lg font-bold text-gray-900">
                {selectedConversation.name}
              </h2>
              <p className="text-sm text-gray-600">{selectedConversation.phone}</p>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {selectedConversation.messages.length === 0 ? (
                <div className="text-center text-gray-500 mt-8">
                  No messages yet
                </div>
              ) : (
                selectedConversation.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className="max-w-xl">
                      <div
                        className={`rounded-2xl px-4 py-2 ${
                          msg.direction === 'outbound'
                            ? 'bg-red-500 text-white rounded-br-none'
                            : 'bg-white text-gray-900 border border-gray-300 rounded-bl-none'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                        {msg.meta?.action && (
                          <p className="text-xs mt-1 opacity-70 font-mono">
                            [{msg.meta.action}]
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1 px-2">
                        {formatTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Select a conversation to view messages
          </div>
        )}
      </div>
    </div>
  )
}

