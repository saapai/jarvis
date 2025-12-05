/**
 * Planner Module
 * Main orchestrator that ties everything together
 */

import {
  PlannerContext,
  PlannerOutput,
  ActionResult,
  UserContext,
  ClassificationResult,
  ConversationTurn
} from './types'

import {
  getConversationHistory,
  addConversationTurn,
  getDraft,
  getRawHistory
} from './history'
import { WeightedTurn, HISTORY_WEIGHTS } from './types'

import { classifyIntent } from './classifier'

import {
  handleDraftWrite,
  handleDraftSend,
  handleContentQuery,
  handleCapabilityQuery,
  handleChat,
  handleEmptyMessage
} from './actions'

// ============================================
// MAIN PLANNER INTERFACE
// ============================================

export interface PlannerInput {
  phone: string
  message: string
  user: UserContext
  // Optional: content search function
  searchContent?: (query: string) => Promise<{ title: string; body: string; score: number }[]>
  // Required for sending drafts
  sendAnnouncement?: (content: string, senderPhone: string) => Promise<number>
  sendPoll?: (question: string, senderPhone: string) => Promise<number>
}

export interface PlannerResult {
  response: string
  action: string
  classification: ClassificationResult
}

/**
 * Main planner function - process a message and return a response
 */
export async function plan(input: PlannerInput): Promise<PlannerResult> {
  const {
    phone,
    message,
    user,
    searchContent,
    sendAnnouncement,
    sendPoll
  } = input
  
  // Handle empty messages
  if (!message || message.trim().length === 0) {
    const result = handleEmptyMessage(user.name)
    addConversationTurn(phone, message, 'user')
    addConversationTurn(phone, result.response, 'assistant')
    
    return {
      response: result.response,
      action: result.action,
      classification: { action: 'chat', confidence: 1.0 }
    }
  }
  
  // Add user message to history
  addConversationTurn(phone, message, 'user')
  
  // Build classification context
  const { turns } = getConversationHistory(phone, 5)
  const weightedHistory: WeightedTurn[] = turns.map((turn, i) => {
    const weightIndex = turns.length - 1 - i
    const weight = HISTORY_WEIGHTS[weightIndex] || 0.2
    return { ...turn, weight }
  })
  const activeDraft = getDraft(phone)
  
  const classificationContext = {
    currentMessage: message,
    history: weightedHistory,
    activeDraft: activeDraft || null,
    isAdmin: user.isAdmin,
    userName: user.name
  }
  
  // Classify intent
  const classification = await classifyIntent(classificationContext)
  
  console.log(`[Planner] Classified "${message}" as ${classification.action} (confidence: ${classification.confidence})`)
  
  // Build planner context
  const plannerContext: PlannerContext = {
    user,
    currentMessage: message,
    history: weightedHistory,
    activeDraft: activeDraft || null,
    timestamp: Date.now()
  }
  
  // Execute appropriate action handler
  let result: ActionResult
  
  switch (classification.action) {
    case 'draft_write':
      result = await handleDraftWrite({
        phone,
        message,
        userName: user.name,
        isAdmin: user.isAdmin,
        classification
      })
      break
    
    case 'draft_send':
      if (!sendAnnouncement || !sendPoll) {
        result = {
          action: 'draft_send',
          response: "send functions not configured. contact admin"
        }
      } else {
        result = await handleDraftSend({
          phone,
          message,
          userName: user.name,
          isAdmin: user.isAdmin,
          sendAnnouncement,
          sendPoll
        })
      }
      break
    
    case 'content_query':
      result = await handleContentQuery({
        phone,
        message,
        userName: user.name,
        searchContent
      })
      break
    
    case 'capability_query':
      result = handleCapabilityQuery({
        phone,
        message,
        userName: user.name,
        isAdmin: user.isAdmin
      })
      break
    
    case 'chat':
    default:
      result = handleChat({
        phone,
        message,
        userName: user.name,
        isAdmin: user.isAdmin
      })
      break
  }
  
  // Add assistant response to history
  addConversationTurn(phone, result.response, 'assistant')
  
  // Return result
  return {
    response: result.response,
    action: result.action,
    classification
  }
}

// ============================================
// RE-EXPORTS
// ============================================

export * from './types'
export * from './history'
export * from './classifier'
export * from './personality'
export * from './actions'

