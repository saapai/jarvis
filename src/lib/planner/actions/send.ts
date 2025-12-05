/**
 * Send Action Handler
 * Handles sending out drafts (announcements/polls)
 */

import { ActionResult } from '../types'
import { getDraft, clearDraft } from '../history'
import { applyPersonality, TEMPLATES } from '../personality'

export interface SendActionInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
  // Function to actually send the announcement/poll
  sendAnnouncement: (content: string, senderPhone: string) => Promise<number>
  sendPoll: (question: string, senderPhone: string) => Promise<number>
}

/**
 * Handle draft send action
 */
export async function handleDraftSend(input: SendActionInput): Promise<ActionResult> {
  const { phone, message, userName, isAdmin, sendAnnouncement, sendPoll } = input
  
  // Non-admins can't send
  if (!isAdmin) {
    return {
      action: 'draft_send',
      response: applyPersonality({
        baseResponse: TEMPLATES.notAdmin(),
        userMessage: message,
        userName
      })
    }
  }
  
  const draft = getDraft(phone)
  
  // No draft to send
  if (!draft) {
    return {
      action: 'draft_send',
      response: applyPersonality({
        baseResponse: TEMPLATES.noDraft(),
        userMessage: message,
        userName
      })
    }
  }
  
  // Draft has no content
  if (!draft.content || draft.content.length < 3) {
    return {
      action: 'draft_send',
      response: applyPersonality({
        baseResponse: TEMPLATES.askForContent(draft.type),
        userMessage: message,
        userName
      })
    }
  }
  
  // Send the draft
  try {
    let sentCount: number
    
    if (draft.type === 'announcement') {
      sentCount = await sendAnnouncement(draft.content, phone)
    } else {
      sentCount = await sendPoll(draft.content, phone)
    }
    
    // Clear the draft after successful send
    clearDraft(phone)
    
    return {
      action: 'draft_send',
      response: applyPersonality({
        baseResponse: TEMPLATES.draftSent(sentCount),
        userMessage: message,
        userName
      }),
      newDraft: undefined  // Draft is cleared
    }
  } catch (error) {
    console.error('[Send] Failed to send draft:', error)
    
    return {
      action: 'draft_send',
      response: applyPersonality({
        baseResponse: `failed to send. try again? error: ${error}`,
        userMessage: message,
        userName
      })
    }
  }
}

/**
 * Handle draft cancellation
 */
export function handleDraftCancel(input: {
  phone: string
  message: string
  userName: string | null
}): ActionResult {
  const { phone, message, userName } = input
  
  const draft = getDraft(phone)
  
  if (!draft) {
    return {
      action: 'chat',
      response: applyPersonality({
        baseResponse: "nothing to cancel rn",
        userMessage: message,
        userName
      })
    }
  }
  
  clearDraft(phone)
  
  return {
    action: 'chat',
    response: applyPersonality({
      baseResponse: TEMPLATES.draftCancelled(),
      userMessage: message,
      userName
    }),
    newDraft: undefined
  }
}

