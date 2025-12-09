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
  phoneNumber: string
  stateType: StateType
  statePayload: Record<string, any> | null
  updatedAt: Date
}

/**
 * Get conversation state for a phone number
 */
export async function getConversationState(
  phoneNumber: string
): Promise<ConversationState | null> {
  const prisma = await getPrisma()
  
  const state = await prisma.conversationState.findUnique({
    where: { phoneNumber }
  })
  
  if (!state) return null
  
  return {
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt
  }
}

/**
 * Set or update conversation state
 */
export async function setConversationState(
  phoneNumber: string,
  stateType: StateType,
  statePayload: Record<string, any> | null = null
): Promise<ConversationState> {
  const prisma = await getPrisma()
  
  const state = await prisma.conversationState.upsert({
    where: { phoneNumber },
    update: {
      stateType,
      statePayload: statePayload ? JSON.stringify(statePayload) : null,
      updatedAt: new Date()
    },
    create: {
      phoneNumber,
      stateType,
      statePayload: statePayload ? JSON.stringify(statePayload) : null,
      updatedAt: new Date()
    }
  })
  
  return {
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt
  }
}

/**
 * Clear conversation state
 */
export async function clearConversationState(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.conversationState.delete({
    where: { phoneNumber }
  }).catch(() => {
    // Ignore if doesn't exist
  })
}

/**
 * Clear stale conversation states (older than 1 hour)
 */
export async function clearStaleStates(): Promise<number> {
  const prisma = await getPrisma()
  
  const oneHourAgo = new Date()
  oneHourAgo.setHours(oneHourAgo.getHours() - 1)
  
  const result = await prisma.conversationState.deleteMany({
    where: {
      updatedAt: {
        lt: oneHourAgo
      }
    }
  })
  
  return result.count
}

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
  phoneNumber: string
  stateType: StateType
  statePayload: Record<string, any> | null
  updatedAt: Date
}

/**
 * Get conversation state for a phone number
 */
export async function getConversationState(
  phoneNumber: string
): Promise<ConversationState | null> {
  const prisma = await getPrisma()
  
  const state = await prisma.conversationState.findUnique({
    where: { phoneNumber }
  })
  
  if (!state) return null
  
  return {
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt
  }
}

/**
 * Set or update conversation state
 */
export async function setConversationState(
  phoneNumber: string,
  stateType: StateType,
  statePayload: Record<string, any> | null = null
): Promise<ConversationState> {
  const prisma = await getPrisma()
  
  const state = await prisma.conversationState.upsert({
    where: { phoneNumber },
    update: {
      stateType,
      statePayload: statePayload ? JSON.stringify(statePayload) : null,
      updatedAt: new Date()
    },
    create: {
      phoneNumber,
      stateType,
      statePayload: statePayload ? JSON.stringify(statePayload) : null,
      updatedAt: new Date()
    }
  })
  
  return {
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt
  }
}

/**
 * Clear conversation state
 */
export async function clearConversationState(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.conversationState.delete({
    where: { phoneNumber }
  }).catch(() => {
    // Ignore if doesn't exist
  })
}

/**
 * Clear stale conversation states (older than 1 hour)
 */
export async function clearStaleStates(): Promise<number> {
  const prisma = await getPrisma()
  
  const oneHourAgo = new Date()
  oneHourAgo.setHours(oneHourAgo.getHours() - 1)
  
  const result = await prisma.conversationState.deleteMany({
    where: {
      updatedAt: {
        lt: oneHourAgo
      }
    }
  })
  
  return result.count
}

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
  phoneNumber: string
  stateType: StateType
  statePayload: Record<string, any> | null
  updatedAt: Date
}

/**
 * Get conversation state for a phone number
 */
export async function getConversationState(
  phoneNumber: string
): Promise<ConversationState | null> {
  const prisma = await getPrisma()
  
  const state = await prisma.conversationState.findUnique({
    where: { phoneNumber }
  })
  
  if (!state) return null
  
  return {
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt
  }
}

/**
 * Set or update conversation state
 */
export async function setConversationState(
  phoneNumber: string,
  stateType: StateType,
  statePayload: Record<string, any> | null = null
): Promise<ConversationState> {
  const prisma = await getPrisma()
  
  const state = await prisma.conversationState.upsert({
    where: { phoneNumber },
    update: {
      stateType,
      statePayload: statePayload ? JSON.stringify(statePayload) : null,
      updatedAt: new Date()
    },
    create: {
      phoneNumber,
      stateType,
      statePayload: statePayload ? JSON.stringify(statePayload) : null,
      updatedAt: new Date()
    }
  })
  
  return {
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt
  }
}

/**
 * Clear conversation state
 */
export async function clearConversationState(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.conversationState.delete({
    where: { phoneNumber }
  }).catch(() => {
    // Ignore if doesn't exist
  })
}

/**
 * Clear stale conversation states (older than 1 hour)
 */
export async function clearStaleStates(): Promise<number> {
  const prisma = await getPrisma()
  
  const oneHourAgo = new Date()
  oneHourAgo.setHours(oneHourAgo.getHours() - 1)
  
  const result = await prisma.conversationState.deleteMany({
    where: {
      updatedAt: {
        lt: oneHourAgo
      }
    }
  })
  
  return result.count
}

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
  phoneNumber: string
  stateType: StateType
  statePayload: Record<string, any> | null
  updatedAt: Date
}

/**
 * Get conversation state for a phone number
 */
export async function getConversationState(
  phoneNumber: string
): Promise<ConversationState | null> {
  const prisma = await getPrisma()
  
  const state = await prisma.conversationState.findUnique({
    where: { phoneNumber }
  })
  
  if (!state) return null
  
  return {
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt
  }
}

/**
 * Set or update conversation state
 */
export async function setConversationState(
  phoneNumber: string,
  stateType: StateType,
  statePayload: Record<string, any> | null = null
): Promise<ConversationState> {
  const prisma = await getPrisma()
  
  const state = await prisma.conversationState.upsert({
    where: { phoneNumber },
    update: {
      stateType,
      statePayload: statePayload ? JSON.stringify(statePayload) : null,
      updatedAt: new Date()
    },
    create: {
      phoneNumber,
      stateType,
      statePayload: statePayload ? JSON.stringify(statePayload) : null,
      updatedAt: new Date()
    }
  })
  
  return {
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt
  }
}

/**
 * Clear conversation state
 */
export async function clearConversationState(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.conversationState.delete({
    where: { phoneNumber }
  }).catch(() => {
    // Ignore if doesn't exist
  })
}

/**
 * Clear stale conversation states (older than 1 hour)
 */
export async function clearStaleStates(): Promise<number> {
  const prisma = await getPrisma()
  
  const oneHourAgo = new Date()
  oneHourAgo.setHours(oneHourAgo.getHours() - 1)
  
  const result = await prisma.conversationState.deleteMany({
    where: {
      updatedAt: {
        lt: oneHourAgo
      }
    }
  })
  
  return result.count
}

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
  phoneNumber: string
  stateType: StateType
  statePayload: Record<string, any> | null
  updatedAt: Date
}

/**
 * Get conversation state for a phone number
 */
export async function getConversationState(
  phoneNumber: string
): Promise<ConversationState | null> {
  const prisma = await getPrisma()
  
  const state = await prisma.conversationState.findUnique({
    where: { phoneNumber }
  })
  
  if (!state) return null
  
  return {
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt
  }
}

/**
 * Set or update conversation state
 */
export async function setConversationState(
  phoneNumber: string,
  stateType: StateType,
  statePayload: Record<string, any> | null = null
): Promise<ConversationState> {
  const prisma = await getPrisma()
  
  const state = await prisma.conversationState.upsert({
    where: { phoneNumber },
    update: {
      stateType,
      statePayload: statePayload ? JSON.stringify(statePayload) : null,
      updatedAt: new Date()
    },
    create: {
      phoneNumber,
      stateType,
      statePayload: statePayload ? JSON.stringify(statePayload) : null,
      updatedAt: new Date()
    }
  })
  
  return {
    phoneNumber: state.phoneNumber,
    stateType: state.stateType as StateType,
    statePayload: state.statePayload ? JSON.parse(state.statePayload) : null,
    updatedAt: state.updatedAt
  }
}

/**
 * Clear conversation state
 */
export async function clearConversationState(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.conversationState.delete({
    where: { phoneNumber }
  }).catch(() => {
    // Ignore if doesn't exist
  })
}

/**
 * Clear stale conversation states (older than 1 hour)
 */
export async function clearStaleStates(): Promise<number> {
  const prisma = await getPrisma()
  
  const oneHourAgo = new Date()
  oneHourAgo.setHours(oneHourAgo.getHours() - 1)
  
  const result = await prisma.conversationState.deleteMany({
    where: {
      updatedAt: {
        lt: oneHourAgo
      }
    }
  })
  
  return result.count
}



