/**
 * Send Action Handler
 * Handles sending out announcement drafts
 */

import { ActionResult } from '../types'
import * as draftRepo from '@/lib/repositories/draftRepository'
import * as messageRepo from '@/lib/repositories/messageRepository'
import { TEMPLATES } from '../personality'

export interface SendActionInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
  sendAnnouncement: (content: string, senderPhone: string) => Promise<number>
  spaceId?: string | null
}

/**
 * Handle draft send action
 */
export async function handleDraftSend(input: SendActionInput): Promise<ActionResult> {
  const { phone, sendAnnouncement, spaceId } = input

  const draft = await draftRepo.getActiveDraft(phone, spaceId)

  console.log(`[Send] Draft found: ${draft ? 'yes' : 'no'}`)

  // No draft to send - check if we recently sent something
  if (!draft) {
    console.log(`[Send] No draft available to send`)

    const recentMessages = await messageRepo.getRecentMessages(phone, 6, spaceId)
    const recentSend = recentMessages.find(m => {
      try {
        const meta = typeof m.meta === 'string' ? JSON.parse(m.meta) : m.meta
        return meta?.action === 'draft_send' && m.direction === 'outbound'
      } catch { return false }
    })

    if (recentSend) {
      try {
        const meta = typeof recentSend.meta === 'string' ? JSON.parse(recentSend.meta) : recentSend.meta
        const draftContent = meta?.draftContent
        if (draftContent) {
          return {
            action: 'draft_send',
            response: `i just sent the announcement "${draftContent.substring(0, 60)}${draftContent.length > 60 ? '...' : ''}". was there another announcement you wanted to send?`
          }
        }
      } catch {}
      return {
        action: 'draft_send',
        response: `already sent that one out. did you want to send a new announcement?`
      }
    }

    return {
      action: 'draft_send',
      response: TEMPLATES.noDraft()
    }
  }

  // Draft has no content
  if (!draft.content || draft.content.length < 3) {
    return {
      action: 'draft_send',
      response: TEMPLATES.askForContent(draft.type)
    }
  }

  // Send the draft
  try {
    console.log(`[Send] Sending announcement: "${draft.content}"`)
    const sentCount = await sendAnnouncement(draft.content, phone)
    console.log(`[Send] Successfully sent to ${sentCount} users`)

    await draftRepo.finalizeDraft(phone, spaceId)

    return {
      action: 'draft_send',
      response: TEMPLATES.draftSent(sentCount),
      newDraft: undefined
    }
  } catch (error) {
    console.error('[Send] Failed to send draft:', error)

    return {
      action: 'draft_send',
      response: "hmm, that didn't go out — something broke on my end. your draft is still saved, just say \"send\" to retry"
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
  const { phone } = input

  const draft = await draftRepo.getActiveDraft(phone)

  if (!draft) {
    return {
      action: 'chat',
      response: "nothing to cancel rn"
    }
  }

  await draftRepo.deleteDraft(phone)

  return {
    action: 'chat',
    response: TEMPLATES.draftCancelled(),
    newDraft: undefined
  }
}
