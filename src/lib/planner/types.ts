/**
 * Planner Types
 * Core type definitions for the conversation planner system
 */

// ============================================
// ACTIONS
// ============================================

export type ActionType = 
  | 'draft_write'      // Create or edit announcement/poll draft
  | 'draft_send'       // Send out an existing draft
  | 'poll_response'    // Reply to an active poll
  | 'content_query'    // Questions about org content (events, meetings, etc.)
  | 'capability_query' // Questions about Jarvis/Enclave capabilities
  | 'knowledge_upload' // Add information to knowledge base (admin only)
  | 'event_update'     // Update event details (admin only)
  | 'chat'             // Banter, insults, random conversation

export type DraftType = 'announcement' | 'poll'

export type DraftStatus = 'idle' | 'drafting' | 'ready' | 'sent'

export interface Draft {
  type: DraftType
  content: string
  status: DraftStatus
  createdAt: number
  updatedAt: number
  pendingLink?: boolean        // Waiting for user to provide a link
  pendingMandatory?: boolean   // Waiting for user to confirm if poll is mandatory
  links?: string[]             // Extracted links from the draft
  requiresExcuse?: boolean     // For polls: require notes if answering "No"
}

// ============================================
// CONVERSATION HISTORY
// ============================================

export type MessageRole = 'user' | 'assistant'

export interface ConversationTurn {
  role: MessageRole
  content: string
  timestamp: number
  action?: ActionType  // What action was taken (for assistant messages)
}

export interface WeightedTurn extends ConversationTurn {
  weight: number  // 1.0 for most recent, decaying for older
}

// ============================================
// CLASSIFICATION
// ============================================

export interface ClassificationResult {
  action: ActionType
  confidence: number  // 0.0 - 1.0
  subtype?: DraftType // For draft_write: announcement or poll
  reasoning?: string  // Why this classification was chosen
}

export interface ClassificationContext {
  currentMessage: string
  history: WeightedTurn[]
  activeDraft: Draft | null
  isAdmin: boolean
  userName: string | null
  hasActivePoll?: boolean
}

// ============================================
// PLANNER CONTEXT
// ============================================

export interface UserContext {
  phone: string
  name: string | null
  isAdmin: boolean
  needsName: boolean
  optedOut: boolean
}

export interface PlannerContext {
  user: UserContext
  currentMessage: string
  history: WeightedTurn[]
  activeDraft: Draft | null
  timestamp: number
}

// ============================================
// PLANNER OUTPUT
// ============================================

export interface ActionResult {
  action: ActionType
  response: string        // The response to send
  newDraft?: Draft        // Updated draft state (if any)
  historyEntry?: ConversationTurn  // Entry to add to history
  pendingConfirmation?: {
    eventId: string
    updates: Record<string, unknown>
    description: string
  }  // For event_update actions awaiting confirmation
}

export interface PlannerOutput {
  result: ActionResult
  classification: ClassificationResult
  context: PlannerContext
}

// ============================================
// PERSONALITY
// ============================================

export type ToneLevel = 'mild' | 'medium' | 'spicy'

export interface PersonalityConfig {
  baseTone: ToneLevel
  matchUserEnergy: boolean  // If user is mean, be meaner back
  useEmoji: boolean
}

export const DEFAULT_PERSONALITY: PersonalityConfig = {
  baseTone: 'medium',
  matchUserEnergy: true,
  useEmoji: true
}

// ============================================
// HISTORY WEIGHTS
// ============================================

/**
 * Weight decay for conversation history
 * Most recent message = 1.0, decays by 0.2 per message
 */
export const HISTORY_WEIGHTS = [1.0, 0.8, 0.6, 0.4, 0.2] as const

export const MAX_HISTORY_LENGTH = 5

// ============================================
// HELPERS
// ============================================

export function createEmptyDraft(type: DraftType): Draft {
  const now = Date.now()
  return {
    type,
    content: '',
    status: 'drafting',
    createdAt: now,
    updatedAt: now
  }
}

export function isDraftActive(draft: Draft | null): boolean {
  if (!draft) return false
  return draft.status === 'drafting' || draft.status === 'ready'
}

export function isDraftReadyToSend(draft: Draft | null): boolean {
  if (!draft) return false
  return draft.status === 'ready' && draft.content.length > 0
}

