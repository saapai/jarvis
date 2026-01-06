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
  getWeightedHistory,
  addToHistory,
  getDraft,
  loadStateFromAirtable,
  getStateForAirtable
} from './history'

import { classifyIntent } from './classifier'

import {
  handleDraftWrite,
  handleDraftSend,
  handleContentQuery,
  handleCapabilityQuery,
  handleChat,
  handleEmptyMessage,
  handlePollResponse
} from './actions'

// ============================================
// MAIN PLANNER INTERFACE
// ============================================

export interface PlannerInput {
  phone: string
  message: string
  user: UserContext
  // Optional: conversation history from Airtable
  conversationHistoryJson?: string | null
  // Optional: content search function
  searchContent?: (query: string) => Promise<{ title: string; body: string; score: number }[]>
  // Required for sending drafts
  sendAnnouncement?: (content: string, senderPhone: string) => Promise<number>
  sendPoll?: (question: string, senderPhone: string) => Promise<number>
  hasActivePoll?: boolean
}

export interface PlannerResult {
  response: string
  action: string
  newConversationHistoryJson: string
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
    conversationHistoryJson,
    searchContent,
    sendAnnouncement,
    sendPoll
  } = input
  
  // Load conversation history from Airtable if provided
  if (conversationHistoryJson) {
    loadStateFromAirtable(phone, conversationHistoryJson)
  }
  
  // Handle empty messages
  if (!message || message.trim().length === 0) {
    const result = handleEmptyMessage(user.name)
    addToHistory(phone, 'user', message)
    addToHistory(phone, 'assistant', result.response, result.action)
    
    return {
      response: result.response,
      action: result.action,
      newConversationHistoryJson: getStateForAirtable(phone),
      classification: { action: 'chat', confidence: 1.0 }
    }
  }
  
  // Add user message to history
  addToHistory(phone, 'user', message)
  
  // Build classification context
  const weightedHistory = getWeightedHistory(phone)
  const activeDraft = getDraft(phone)
  
  const classificationContext = {
    currentMessage: message,
    history: weightedHistory,
    activeDraft,
    isAdmin: user.isAdmin,
    userName: user.name,
    hasActivePoll: input.hasActivePoll ?? false
  }
  
  // Classify intent
  const classification = await classifyIntent(classificationContext)
  
  console.log(`[Planner] Classified "${message}" as ${classification.action} (confidence: ${classification.confidence})`)
  
  // Build planner context
  const plannerContext: PlannerContext = {
    user,
    currentMessage: message,
    history: weightedHistory,
    activeDraft,
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

    case 'poll_response':
      result = await handlePollResponse({
        phone,
        message,
        userName: user.name
      })
      break
    
    case 'capability_query':
      result = await handleCapabilityQuery({
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
  addToHistory(phone, 'assistant', result.response, result.action)
  
  // Return result with updated history
  return {
    response: result.response,
    action: result.action,
    newConversationHistoryJson: getStateForAirtable(phone),
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

