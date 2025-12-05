/**
 * History Management
 * Manages conversation history and draft state for the planner
 */

import { Draft, DraftType, ConversationTurn } from './types'

// ============================================
// IN-MEMORY STORAGE
// ============================================

// Conversation history per user (keyed by phone)
const conversationHistory: Map<string, ConversationTurn[]> = new Map()

// Active drafts per user (keyed by phone)
const activeDrafts: Map<string, Draft> = new Map()

// Maximum history length
const MAX_HISTORY_LENGTH = 10

// ============================================
// CONVERSATION HISTORY
// ============================================

/**
 * Add a conversation turn to history
 */
export function addConversationTurn(
  phone: string,
  content: string,
  role: 'user' | 'assistant'
): void {
  const history = conversationHistory.get(phone) || []
  
  history.push({
    content,
    role,
    timestamp: Date.now()
  })
  
  // Keep only last MAX_HISTORY_LENGTH turns
  while (history.length > MAX_HISTORY_LENGTH) {
    history.shift()
  }
  
  conversationHistory.set(phone, history)
}

/**
 * Get conversation history with weighted context
 * More recent messages get higher weights
 */
export function getConversationHistory(
  phone: string,
  count: number = 5
): { turns: ConversationTurn[]; weightedContext: string } {
  const history = conversationHistory.get(phone) || []
  const recentTurns = history.slice(-count)
  
  // Build weighted context string
  // Weight decreases with age: 1.0, 0.8, 0.6, 0.4, 0.2
  const weights = [0.2, 0.4, 0.6, 0.8, 1.0].slice(-recentTurns.length)
  
  const weightedContext = recentTurns
    .map((turn, i) => {
      const weight = weights[i] || 0.2
      return `[${weight.toFixed(1)}] ${turn.role}: ${turn.content}`
    })
    .join('\n')
  
  return { turns: recentTurns, weightedContext }
}

/**
 * Clear history for a user
 */
export function clearHistory(phone: string): void {
  conversationHistory.delete(phone)
}

/**
 * Get raw history turns
 */
export function getRawHistory(phone: string): ConversationTurn[] {
  return conversationHistory.get(phone) || []
}

// ============================================
// DRAFT MANAGEMENT
// ============================================

/**
 * Get the current draft for a user
 */
export function getDraft(phone: string): Draft | undefined {
  return activeDrafts.get(phone)
}

/**
 * Set/create a draft for a user
 * Can accept either (phone, type, content) or (phone, draft)
 */
export function setDraft(
  phone: string,
  typeOrDraft: DraftType | Draft,
  content?: string
): Draft {
  let draft: Draft
  const now = Date.now()
  
  if (typeof typeOrDraft === 'object') {
    // Called with a Draft object
    draft = {
      type: typeOrDraft.type,
      content: typeOrDraft.content,
      status: typeOrDraft.status || 'drafting',
      createdAt: typeOrDraft.createdAt || now,
      updatedAt: typeOrDraft.updatedAt || now
    }
  } else {
    // Called with type and content
    draft = {
      type: typeOrDraft,
      content: content || '',
      status: 'drafting',
      createdAt: now,
      updatedAt: now
    }
  }
  
  activeDrafts.set(phone, draft)
  return draft
}

/**
 * Update an existing draft
 * Can accept either (phone, content) or (phone, partialDraft)
 */
export function updateDraft(
  phone: string,
  contentOrPartial: string | Partial<Draft>
): Draft | undefined {
  const existing = activeDrafts.get(phone)
  if (!existing) return undefined
  
  if (typeof contentOrPartial === 'string') {
    existing.content = contentOrPartial
  } else {
    Object.assign(existing, contentOrPartial)
  }
  
  existing.updatedAt = Date.now()
  activeDrafts.set(phone, existing)
  return existing
}

/**
 * Clear/delete a draft
 */
export function clearDraft(phone: string): void {
  activeDrafts.delete(phone)
}

/**
 * Check if user has an active draft
 */
export function hasDraft(phone: string): boolean {
  return activeDrafts.has(phone)
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get context summary for debugging
 */
export function getContextSummary(phone: string): string {
  const history = conversationHistory.get(phone) || []
  const draft = activeDrafts.get(phone)
  
  return `History: ${history.length} turns, Draft: ${draft ? `${draft.type} "${draft.content.slice(0, 30)}..."` : 'none'}`
}

/**
 * Clear all state for a user (history + draft)
 */
export function clearAllState(phone: string): void {
  clearHistory(phone)
  clearDraft(phone)
}
