import { ActionResult } from '../types'
import * as pollRepo from '@/lib/repositories/pollRepository'
import { parsePollResponse } from '../pollResponseParser'
import { applyPersonality } from '../personality'

export interface PollResponseInput {
  phone: string
  message: string
  userName: string | null
}

/**
 * Handle poll response action
 */
export async function handlePollResponse(input: PollResponseInput): Promise<ActionResult> {
  const { phone, message, userName } = input

  const activePoll = await pollRepo.getActivePoll()

  if (!activePoll) {
    return {
      action: 'chat',
      response: applyPersonality({
        baseResponse: 'no active poll right now',
        userMessage: message,
        userName
      })
    }
  }

  const parsed = await parsePollResponse(message)

  // Enforce excuse requirement for mandatory events
  if (activePoll.requiresReasonForNo && parsed.response === 'No' && !parsed.notes) {
    console.log(`[PollResponse] Poll requires excuse for "No" but none provided`)
    return {
      action: 'poll_response',
      response: applyPersonality({
        baseResponse: "this event is mandatory - can you tell me why you can't make it?",
        userMessage: message,
        userName
      })
    }
  }

  await pollRepo.savePollResponse(activePoll.id, phone, parsed.response, parsed.notes)

  let confirmationMsg = `got it! recorded: ${parsed.response}`
  if (parsed.notes) {
    confirmationMsg += ` (note: "${parsed.notes}")`
  }

  return {
    action: 'poll_response',
    response: applyPersonality({
      baseResponse: confirmationMsg,
      userMessage: message,
      userName
    })
  }
}

/**
 * Check if user has an active poll to respond to
 */
export async function hasActivePoll(): Promise<boolean> {
  const activePoll = await pollRepo.getActivePoll()
  return activePoll !== null
}









