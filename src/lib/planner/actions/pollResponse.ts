/**
 * Poll Response Handler
 * Handles user responses to active polls
 */

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
  
  // Get active poll
  const activePoll = await pollRepo.getActivePoll()
  
  if (!activePoll) {
    return {
      action: 'chat',
      response: applyPersonality({
        baseResponse: "no active poll right now",
        userMessage: message,
        userName
      })
    }
  }
  
  // Parse the response
  const parsed = parsePollResponse(message)
  
  // Save response
  await pollRepo.savePollResponse(
    activePoll.id,
    phone,
    parsed.response,
    parsed.notes
  )
  
  // Build confirmation message
  let confirmationMsg = `got it! recorded: ${parsed.response}`
  if (parsed.notes) {
    confirmationMsg += ` (note: "${parsed.notes}")`
  }
  
  return {
    action: 'chat',
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
