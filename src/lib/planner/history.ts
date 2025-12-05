/**
 * Conversation History Module
 * Stores and retrieves weighted conversation context
 */

import {
  ConversationTurn,
  WeightedTurn,
  Draft,
  HISTORY_WEIGHTS,
  MAX_HISTORY_LENGTH,
  MessageRole
} from './types'

// ============================================
// IN-MEMORY STORAGE (can be swapped for Airtable)
// ============================================

interface UserState {
  history: ConversationTurn[]
  draft: Draft | null
}

// Phone -> UserState mapping
const userStates = new Map<string, UserState>()

function getOrCreateState(phone: string): UserState {
  let state = userStates.get(phone)
  if (!state) {
    state = { history: [], draft: null }
    userStates.set(phone, state)
  }
  return state
}

// ============================================
// HISTORY OPERATIONS
// ============================================

/**
 * Get conversation history with weights applied
 * Most recent message has weight 1.0, decays for older messages
 */
export function getWeightedHistory(phone: string): WeightedTurn[] {
  const state = getOrCreateState(phone)
  const history = state.history.slice(-MAX_HISTORY_LENGTH)
  
  // Apply weights (most recent first)
  return history.map((turn, index) => {
    const reverseIndex = history.length - 1 - index
    const weight = HISTORY_WEIGHTS[reverseIndex] ?? 0.2
    return { ...turn, weight }
  })
}

/**
 * Get raw conversation history (last N messages)
 */
export function getHistory(phone: string, limit = MAX_HISTORY_LENGTH): ConversationTurn[] {
  const state = getOrCreateState(phone)
  return state.history.slice(-limit)
}

/**
 * Add a message to conversation history
 */
export function addToHistory(
  phone: string,
  role: MessageRole,
  content: string,
  action?: string
): ConversationTurn {
  const state = getOrCreateState(phone)
  
  const turn: ConversationTurn = {
    role,
    content,
    timestamp: Date.now(),
    action: action as any
  }
  
  state.history.push(turn)
  
  // Keep only last N messages
  if (state.history.length > MAX_HISTORY_LENGTH * 2) {
    state.history = state.history.slice(-MAX_HISTORY_LENGTH)
  }
  
  return turn
}

/**
 * Clear conversation history for a user
 */
export function clearHistory(phone: string): void {
  const state = getOrCreateState(phone)
  state.history = []
}

// ============================================
// DRAFT OPERATIONS
// ============================================

/**
 * Get active draft for a user
 */
export function getDraft(phone: string): Draft | null {
  const state = getOrCreateState(phone)
  return state.draft
}

/**
 * Set draft for a user
 */
export function setDraft(phone: string, draft: Draft | null): void {
  const state = getOrCreateState(phone)
  state.draft = draft
}

/**
 * Update draft content
 */
export function updateDraft(phone: string, updates: Partial<Draft>): Draft | null {
  const state = getOrCreateState(phone)
  if (!state.draft) return null
  
  state.draft = {
    ...state.draft,
    ...updates,
    updatedAt: Date.now()
  }
  
  return state.draft
}

/**
 * Clear draft for a user
 */
export function clearDraft(phone: string): void {
  const state = getOrCreateState(phone)
  state.draft = null
}

// ============================================
// CONTEXT HELPERS
// ============================================

/**
 * Get the last assistant message (for context-based classification)
 */
export function getLastAssistantMessage(phone: string): string | null {
  const state = getOrCreateState(phone)
  for (let i = state.history.length - 1; i >= 0; i--) {
    if (state.history[i].role === 'assistant') {
      return state.history[i].content
    }
  }
  return null
}

/**
 * Get the last user message (excluding current)
 */
export function getLastUserMessage(phone: string): string | null {
  const state = getOrCreateState(phone)
  // Skip the most recent (current) message
  for (let i = state.history.length - 2; i >= 0; i--) {
    if (state.history[i].role === 'user') {
      return state.history[i].content
    }
  }
  return null
}

/**
 * Check if bot just asked for draft content
 */
export function isAwaitingDraftContent(phone: string): boolean {
  const lastMsg = getLastAssistantMessage(phone)
  if (!lastMsg) return false
  
  const lower = lastMsg.toLowerCase()
  return (
    lower.includes('what would you like to announce') ||
    lower.includes('what would you like the announcement to say') ||
    lower.includes("what's your poll question") ||
    lower.includes('what do you want to ask') ||
    lower.includes('what should the poll say')
  )
}

/**
 * Check if bot just showed a draft preview
 */
export function isAwaitingDraftConfirmation(phone: string): boolean {
  const lastMsg = getLastAssistantMessage(phone)
  if (!lastMsg) return false
  
  const lower = lastMsg.toLowerCase()
  return (
    lower.includes('ready to send') ||
    lower.includes('reply "send"') ||
    lower.includes("reply 'send'") ||
    lower.includes('send or cancel')
  )
}

// ============================================
// SERIALIZATION (for Airtable storage)
// ============================================

/**
 * Serialize user state to JSON string (for Airtable storage)
 */
export function serializeState(phone: string): string {
  const state = getOrCreateState(phone)
  return JSON.stringify({
    history: state.history.slice(-MAX_HISTORY_LENGTH),
    draft: state.draft
  })
}

/**
 * Deserialize user state from JSON string
 */
export function deserializeState(phone: string, json: string): void {
  try {
    const parsed = JSON.parse(json)
    const state = getOrCreateState(phone)
    
    if (Array.isArray(parsed.history)) {
      state.history = parsed.history
    }
    if (parsed.draft && typeof parsed.draft === 'object') {
      state.draft = parsed.draft
    }
  } catch (e) {
    console.error('[History] Failed to deserialize state:', e)
  }
}

/**
 * Load state from Airtable field (call on user lookup)
 */
export function loadStateFromAirtable(phone: string, conversationHistoryJson: string | null): void {
  if (conversationHistoryJson) {
    deserializeState(phone, conversationHistoryJson)
  }
}

/**
 * Get state JSON for Airtable update
 */
export function getStateForAirtable(phone: string): string {
  return serializeState(phone)
}

