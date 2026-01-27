/**
 * Conversation State Repository
 * Manages ephemeral conversation state
 */

import { getPrisma } from '@/lib/prisma'

export type StateType =
  | 'onboarding'
  | 'draft_announcement'
  | 'draft_poll'
  | 'answering_poll'
  | 'collecting_reason'
  | null

export interface ConversationState {
  id: string
  phoneNumber: string
  stateType: StateType
  statePayload: Record<string, any> | null
  updatedAt: Date
  spaceId: string | null
  activeSpaceId: string | null
}

/**
 * Get conversation state for a phone number (optionally scoped to a space)
 * @param spaceId - Optional space ID to scope the state
 */
export async function getConversationState(
  phoneNumber: string,
  spaceId?: string | null
): Promise<ConversationState | null> {
  const prisma = await getPrisma()

  let state
  if (spaceId) {
    // Get state for specific space
    state = await prisma.conversationState.findUnique({
      where: {
        phoneNumber_spaceId: {
          phoneNumber,
          spaceId
        }
      }
    })
  } else {
    // Get most recent state for this phone (legacy behavior)
    state = await prisma.conversationState.findFirst({
      where: { phoneNumber },
      orderBy: { updatedAt: 'desc' }
    })
  }

  if (!state) return null

  return {
    id: state.id,
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt,
    spaceId: state.spaceId,
    activeSpaceId: state.activeSpaceId
  }
}

/**
 * Set or update conversation state
 * @param spaceId - Optional space ID to scope the state
 */
export async function setConversationState(
  phoneNumber: string,
  stateType: StateType,
  statePayload: Record<string, any> | null = null,
  spaceId?: string | null
): Promise<ConversationState> {
  const prisma = await getPrisma()

  let state
  if (spaceId) {
    // Use space-scoped upsert
    state = await prisma.conversationState.upsert({
      where: {
        phoneNumber_spaceId: {
          phoneNumber,
          spaceId
        }
      },
      update: {
        stateType,
        statePayload: statePayload ? JSON.stringify(statePayload) : null,
        updatedAt: new Date()
      },
      create: {
        phoneNumber,
        spaceId,
        stateType,
        statePayload: statePayload ? JSON.stringify(statePayload) : null,
        updatedAt: new Date()
      }
    })
  } else {
    // Legacy behavior: find existing or create new
    const existing = await prisma.conversationState.findFirst({
      where: { phoneNumber },
      orderBy: { updatedAt: 'desc' }
    })

    if (existing) {
      state = await prisma.conversationState.update({
        where: { id: existing.id },
        data: {
          stateType,
          statePayload: statePayload ? JSON.stringify(statePayload) : null,
          updatedAt: new Date()
        }
      })
    } else {
      state = await prisma.conversationState.create({
        data: {
          phoneNumber,
          stateType,
          statePayload: statePayload ? JSON.stringify(statePayload) : null,
          updatedAt: new Date()
        }
      })
    }
  }

  return {
    id: state.id,
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt,
    spaceId: state.spaceId,
    activeSpaceId: state.activeSpaceId
  }
}

/**
 * Clear conversation state
 * @param spaceId - Optional space ID to scope the clear
 */
export async function clearConversationState(phoneNumber: string, spaceId?: string | null): Promise<void> {
  const prisma = await getPrisma()

  if (spaceId) {
    await prisma.conversationState.delete({
      where: {
        phoneNumber_spaceId: {
          phoneNumber,
          spaceId
        }
      }
    }).catch(() => {
      // Ignore if not present
    })
  } else {
    // Clear all states for this phone (legacy behavior)
    await prisma.conversationState.deleteMany({
      where: { phoneNumber }
    }).catch(() => {
      // Ignore if not present
    })
  }
}

/**
 * Clear stale conversation states (older than 1 hour)
 */
export async function clearStaleStates(): Promise<number> {
  const prisma = await getPrisma()

  const oneHourAgo = new Date()
  oneHourAgo.setHours(oneHourAgo.getHours() - 1)

  const result = await prisma.conversationState.deleteMany({
    where: { updatedAt: { lt: oneHourAgo } }
  })

  return result.count
}
