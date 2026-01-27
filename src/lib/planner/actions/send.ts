/**
 * Send Action Handler
 * Handles sending out drafts (announcements/polls)
 */

import { ActionResult } from '../types'
import * as draftRepo from '@/lib/repositories/draftRepository'
import { applyPersonality, TEMPLATES } from '../personality'

export interface SendActionInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
  // Function to actually send the announcement/poll
  sendAnnouncement: (content: string, senderPhone: string) => Promise<number>
  sendPoll: (question: string, senderPhone: string, requiresExcuse?: boolean) => Promise<number>
  spaceId?: string | null
}

/**
 * Handle draft send action
 */
export async function handleDraftSend(input: SendActionInput): Promise<ActionResult> {
  const { phone, message, userName, sendAnnouncement, sendPoll } = input
  
  const draft = await draftRepo.getActiveDraft(phone)
  
  console.log(`[Send] Draft found: ${draft ? 'yes' : 'no'}`)
  
  // No draft to send
  if (!draft) {
    console.log(`[Send] No draft available to send`)
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
    
    console.log(`[Send] Sending ${draft.type}: "${draft.content}"`)
    
    if (draft.type === 'announcement') {
      sentCount = await sendAnnouncement(draft.content, phone)
    } else {
      console.log(`[Send] Sending poll with requiresExcuse=${draft.requiresExcuse}`)
      sentCount = await sendPoll(draft.content, phone, draft.requiresExcuse)
    }
    
    console.log(`[Send] Successfully sent to ${sentCount} users`)
    
    // Finalize the draft after successful send
    await draftRepo.finalizeDraft(phone)
    
    return {
      action: 'draft_send',
      response: applyPersonality({
        baseResponse: TEMPLATES.draftSent(sentCount),
        userMessage: message,
        userName
      }),
      newDraft: undefined  // Draft is finalized
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
export async function handleDraftCancel(input: {
  phone: string
  message: string
  userName: string | null
}): Promise<ActionResult> {
  const { phone, message, userName } = input
  
  const draft = await draftRepo.getActiveDraft(phone)
  
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
  
  await draftRepo.deleteDraft(phone)
  
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

