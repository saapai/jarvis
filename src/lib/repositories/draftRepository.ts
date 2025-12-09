/**
 * Draft Repository
 * Manages announcement and poll drafts
 */

import { getPrisma } from '@/lib/prisma'
import type { Draft, DraftType, DraftStatus } from '@/lib/planner/types'

export interface StructuredPayload {
  event?: string
  time?: string
  date?: string
  tone?: string
  audience?: string
}

export interface AnnouncementDraftDB {
  id: string
  phoneNumber: string
  draftText: string
  structuredPayload: StructuredPayload | null
  status: 'in_progress' | 'finalized'
  createdAt: Date
  updatedAt: Date
}

/**
 * Create a new draft
 */
export async function createDraft(
  phoneNumber: string,
  type: DraftType,
  content: string,
  structuredPayload: StructuredPayload | null = null
): Promise<AnnouncementDraftDB> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.create({
    data: {
      phoneNumber,
      draftText: content,
      structuredPayload: structuredPayload ? JSON.stringify(structuredPayload) : null,
      status: 'in_progress',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
  
  return {
    ...draft,
    structuredPayload: draft.structuredPayload ? JSON.parse(draft.structuredPayload) : null,
    status: draft.status as 'in_progress' | 'finalized'
  }
}

/**
 * Get active draft for a phone number
 */
export async function getActiveDraft(phoneNumber: string): Promise<Draft | null> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.findFirst({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!draft) return null
  
  // Convert to planner Draft format
  return {
    type: 'announcement', // We'll track type separately in the future
    content: draft.draftText,
    status: draft.status === 'in_progress' 
      ? (draft.draftText ? 'ready' : 'drafting')
      : 'sent',
    createdAt: draft.createdAt.getTime(),
    updatedAt: draft.updatedAt.getTime()
  }
}

/**
 * Update an existing draft
 */
export async function updateDraft(
  id: string,
  updates: {
    draftText?: string
    structuredPayload?: StructuredPayload | null
    status?: 'in_progress' | 'finalized'
  }
): Promise<AnnouncementDraftDB> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.update({
    where: { id },
    data: {
      ...(updates.draftText !== undefined && { draftText: updates.draftText }),
      ...(updates.structuredPayload !== undefined && {
        structuredPayload: updates.structuredPayload 
          ? JSON.stringify(updates.structuredPayload) 
          : null
      }),
      ...(updates.status && { status: updates.status }),
      updatedAt: new Date()
    }
  })
  
  return {
    ...draft,
    structuredPayload: draft.structuredPayload ? JSON.parse(draft.structuredPayload) : null,
    status: draft.status as 'in_progress' | 'finalized'
  }
}

/**
 * Update draft by phone number
 */
export async function updateDraftByPhone(
  phoneNumber: string,
  updates: {
    draftText?: string
    structuredPayload?: StructuredPayload | null
    status?: 'in_progress' | 'finalized'
  }
): Promise<AnnouncementDraftDB | null> {
  const prisma = await getPrisma()
  
  const existingDraft = await prisma.announcementDraft.findFirst({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!existingDraft) return null
  
  return updateDraft(existingDraft.id, updates)
}

/**
 * Mark draft as finalized
 */
export async function finalizeDraft(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.announcementDraft.updateMany({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    data: {
      status: 'finalized',
      updatedAt: new Date()
    }
  })
}

/**
 * Delete draft
 */
export async function deleteDraft(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.announcementDraft.deleteMany({
    where: {
      phoneNumber,
      status: 'in_progress'
    }
  })
}

/**
 * Clear stale drafts (older than 24 hours)
 */
export async function clearStaleDrafts(): Promise<number> {
  const prisma = await getPrisma()
  
  const oneDayAgo = new Date()
  oneDayAgo.setDate(oneDayAgo.getDate() - 1)
  
  const result = await prisma.announcementDraft.deleteMany({
    where: {
      status: 'in_progress',
      createdAt: {
        lt: oneDayAgo
      }
    }
  })
  
  return result.count
}

 * Draft Repository
 * Manages announcement and poll drafts
 */

import { getPrisma } from '@/lib/prisma'
import type { Draft, DraftType, DraftStatus } from '@/lib/planner/types'

export interface StructuredPayload {
  event?: string
  time?: string
  date?: string
  tone?: string
  audience?: string
}

export interface AnnouncementDraftDB {
  id: string
  phoneNumber: string
  draftText: string
  structuredPayload: StructuredPayload | null
  status: 'in_progress' | 'finalized'
  createdAt: Date
  updatedAt: Date
}

/**
 * Create a new draft
 */
export async function createDraft(
  phoneNumber: string,
  type: DraftType,
  content: string,
  structuredPayload: StructuredPayload | null = null
): Promise<AnnouncementDraftDB> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.create({
    data: {
      phoneNumber,
      draftText: content,
      structuredPayload: structuredPayload ? JSON.stringify(structuredPayload) : null,
      status: 'in_progress',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
  
  return {
    ...draft,
    structuredPayload: draft.structuredPayload ? JSON.parse(draft.structuredPayload) : null,
    status: draft.status as 'in_progress' | 'finalized'
  }
}

/**
 * Get active draft for a phone number
 */
export async function getActiveDraft(phoneNumber: string): Promise<Draft | null> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.findFirst({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!draft) return null
  
  // Convert to planner Draft format
  return {
    type: 'announcement', // We'll track type separately in the future
    content: draft.draftText,
    status: draft.status === 'in_progress' 
      ? (draft.draftText ? 'ready' : 'drafting')
      : 'sent',
    createdAt: draft.createdAt.getTime(),
    updatedAt: draft.updatedAt.getTime()
  }
}

/**
 * Update an existing draft
 */
export async function updateDraft(
  id: string,
  updates: {
    draftText?: string
    structuredPayload?: StructuredPayload | null
    status?: 'in_progress' | 'finalized'
  }
): Promise<AnnouncementDraftDB> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.update({
    where: { id },
    data: {
      ...(updates.draftText !== undefined && { draftText: updates.draftText }),
      ...(updates.structuredPayload !== undefined && {
        structuredPayload: updates.structuredPayload 
          ? JSON.stringify(updates.structuredPayload) 
          : null
      }),
      ...(updates.status && { status: updates.status }),
      updatedAt: new Date()
    }
  })
  
  return {
    ...draft,
    structuredPayload: draft.structuredPayload ? JSON.parse(draft.structuredPayload) : null,
    status: draft.status as 'in_progress' | 'finalized'
  }
}

/**
 * Update draft by phone number
 */
export async function updateDraftByPhone(
  phoneNumber: string,
  updates: {
    draftText?: string
    structuredPayload?: StructuredPayload | null
    status?: 'in_progress' | 'finalized'
  }
): Promise<AnnouncementDraftDB | null> {
  const prisma = await getPrisma()
  
  const existingDraft = await prisma.announcementDraft.findFirst({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!existingDraft) return null
  
  return updateDraft(existingDraft.id, updates)
}

/**
 * Mark draft as finalized
 */
export async function finalizeDraft(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.announcementDraft.updateMany({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    data: {
      status: 'finalized',
      updatedAt: new Date()
    }
  })
}

/**
 * Delete draft
 */
export async function deleteDraft(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.announcementDraft.deleteMany({
    where: {
      phoneNumber,
      status: 'in_progress'
    }
  })
}

/**
 * Clear stale drafts (older than 24 hours)
 */
export async function clearStaleDrafts(): Promise<number> {
  const prisma = await getPrisma()
  
  const oneDayAgo = new Date()
  oneDayAgo.setDate(oneDayAgo.getDate() - 1)
  
  const result = await prisma.announcementDraft.deleteMany({
    where: {
      status: 'in_progress',
      createdAt: {
        lt: oneDayAgo
      }
    }
  })
  
  return result.count
}

 * Draft Repository
 * Manages announcement and poll drafts
 */

import { getPrisma } from '@/lib/prisma'
import type { Draft, DraftType, DraftStatus } from '@/lib/planner/types'

export interface StructuredPayload {
  event?: string
  time?: string
  date?: string
  tone?: string
  audience?: string
}

export interface AnnouncementDraftDB {
  id: string
  phoneNumber: string
  draftText: string
  structuredPayload: StructuredPayload | null
  status: 'in_progress' | 'finalized'
  createdAt: Date
  updatedAt: Date
}

/**
 * Create a new draft
 */
export async function createDraft(
  phoneNumber: string,
  type: DraftType,
  content: string,
  structuredPayload: StructuredPayload | null = null
): Promise<AnnouncementDraftDB> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.create({
    data: {
      phoneNumber,
      draftText: content,
      structuredPayload: structuredPayload ? JSON.stringify(structuredPayload) : null,
      status: 'in_progress',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
  
  return {
    ...draft,
    structuredPayload: draft.structuredPayload ? JSON.parse(draft.structuredPayload) : null,
    status: draft.status as 'in_progress' | 'finalized'
  }
}

/**
 * Get active draft for a phone number
 */
export async function getActiveDraft(phoneNumber: string): Promise<Draft | null> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.findFirst({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!draft) return null
  
  // Convert to planner Draft format
  return {
    type: 'announcement', // We'll track type separately in the future
    content: draft.draftText,
    status: draft.status === 'in_progress' 
      ? (draft.draftText ? 'ready' : 'drafting')
      : 'sent',
    createdAt: draft.createdAt.getTime(),
    updatedAt: draft.updatedAt.getTime()
  }
}

/**
 * Update an existing draft
 */
export async function updateDraft(
  id: string,
  updates: {
    draftText?: string
    structuredPayload?: StructuredPayload | null
    status?: 'in_progress' | 'finalized'
  }
): Promise<AnnouncementDraftDB> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.update({
    where: { id },
    data: {
      ...(updates.draftText !== undefined && { draftText: updates.draftText }),
      ...(updates.structuredPayload !== undefined && {
        structuredPayload: updates.structuredPayload 
          ? JSON.stringify(updates.structuredPayload) 
          : null
      }),
      ...(updates.status && { status: updates.status }),
      updatedAt: new Date()
    }
  })
  
  return {
    ...draft,
    structuredPayload: draft.structuredPayload ? JSON.parse(draft.structuredPayload) : null,
    status: draft.status as 'in_progress' | 'finalized'
  }
}

/**
 * Update draft by phone number
 */
export async function updateDraftByPhone(
  phoneNumber: string,
  updates: {
    draftText?: string
    structuredPayload?: StructuredPayload | null
    status?: 'in_progress' | 'finalized'
  }
): Promise<AnnouncementDraftDB | null> {
  const prisma = await getPrisma()
  
  const existingDraft = await prisma.announcementDraft.findFirst({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!existingDraft) return null
  
  return updateDraft(existingDraft.id, updates)
}

/**
 * Mark draft as finalized
 */
export async function finalizeDraft(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.announcementDraft.updateMany({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    data: {
      status: 'finalized',
      updatedAt: new Date()
    }
  })
}

/**
 * Delete draft
 */
export async function deleteDraft(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.announcementDraft.deleteMany({
    where: {
      phoneNumber,
      status: 'in_progress'
    }
  })
}

/**
 * Clear stale drafts (older than 24 hours)
 */
export async function clearStaleDrafts(): Promise<number> {
  const prisma = await getPrisma()
  
  const oneDayAgo = new Date()
  oneDayAgo.setDate(oneDayAgo.getDate() - 1)
  
  const result = await prisma.announcementDraft.deleteMany({
    where: {
      status: 'in_progress',
      createdAt: {
        lt: oneDayAgo
      }
    }
  })
  
  return result.count
}

 * Draft Repository
 * Manages announcement and poll drafts
 */

import { getPrisma } from '@/lib/prisma'
import type { Draft, DraftType, DraftStatus } from '@/lib/planner/types'

export interface StructuredPayload {
  event?: string
  time?: string
  date?: string
  tone?: string
  audience?: string
}

export interface AnnouncementDraftDB {
  id: string
  phoneNumber: string
  draftText: string
  structuredPayload: StructuredPayload | null
  status: 'in_progress' | 'finalized'
  createdAt: Date
  updatedAt: Date
}

/**
 * Create a new draft
 */
export async function createDraft(
  phoneNumber: string,
  type: DraftType,
  content: string,
  structuredPayload: StructuredPayload | null = null
): Promise<AnnouncementDraftDB> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.create({
    data: {
      phoneNumber,
      draftText: content,
      structuredPayload: structuredPayload ? JSON.stringify(structuredPayload) : null,
      status: 'in_progress',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
  
  return {
    ...draft,
    structuredPayload: draft.structuredPayload ? JSON.parse(draft.structuredPayload) : null,
    status: draft.status as 'in_progress' | 'finalized'
  }
}

/**
 * Get active draft for a phone number
 */
export async function getActiveDraft(phoneNumber: string): Promise<Draft | null> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.findFirst({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!draft) return null
  
  // Convert to planner Draft format
  return {
    type: 'announcement', // We'll track type separately in the future
    content: draft.draftText,
    status: draft.status === 'in_progress' 
      ? (draft.draftText ? 'ready' : 'drafting')
      : 'sent',
    createdAt: draft.createdAt.getTime(),
    updatedAt: draft.updatedAt.getTime()
  }
}

/**
 * Update an existing draft
 */
export async function updateDraft(
  id: string,
  updates: {
    draftText?: string
    structuredPayload?: StructuredPayload | null
    status?: 'in_progress' | 'finalized'
  }
): Promise<AnnouncementDraftDB> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.update({
    where: { id },
    data: {
      ...(updates.draftText !== undefined && { draftText: updates.draftText }),
      ...(updates.structuredPayload !== undefined && {
        structuredPayload: updates.structuredPayload 
          ? JSON.stringify(updates.structuredPayload) 
          : null
      }),
      ...(updates.status && { status: updates.status }),
      updatedAt: new Date()
    }
  })
  
  return {
    ...draft,
    structuredPayload: draft.structuredPayload ? JSON.parse(draft.structuredPayload) : null,
    status: draft.status as 'in_progress' | 'finalized'
  }
}

/**
 * Update draft by phone number
 */
export async function updateDraftByPhone(
  phoneNumber: string,
  updates: {
    draftText?: string
    structuredPayload?: StructuredPayload | null
    status?: 'in_progress' | 'finalized'
  }
): Promise<AnnouncementDraftDB | null> {
  const prisma = await getPrisma()
  
  const existingDraft = await prisma.announcementDraft.findFirst({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!existingDraft) return null
  
  return updateDraft(existingDraft.id, updates)
}

/**
 * Mark draft as finalized
 */
export async function finalizeDraft(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.announcementDraft.updateMany({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    data: {
      status: 'finalized',
      updatedAt: new Date()
    }
  })
}

/**
 * Delete draft
 */
export async function deleteDraft(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.announcementDraft.deleteMany({
    where: {
      phoneNumber,
      status: 'in_progress'
    }
  })
}

/**
 * Clear stale drafts (older than 24 hours)
 */
export async function clearStaleDrafts(): Promise<number> {
  const prisma = await getPrisma()
  
  const oneDayAgo = new Date()
  oneDayAgo.setDate(oneDayAgo.getDate() - 1)
  
  const result = await prisma.announcementDraft.deleteMany({
    where: {
      status: 'in_progress',
      createdAt: {
        lt: oneDayAgo
      }
    }
  })
  
  return result.count
}

 * Draft Repository
 * Manages announcement and poll drafts
 */

import { getPrisma } from '@/lib/prisma'
import type { Draft, DraftType, DraftStatus } from '@/lib/planner/types'

export interface StructuredPayload {
  event?: string
  time?: string
  date?: string
  tone?: string
  audience?: string
}

export interface AnnouncementDraftDB {
  id: string
  phoneNumber: string
  draftText: string
  structuredPayload: StructuredPayload | null
  status: 'in_progress' | 'finalized'
  createdAt: Date
  updatedAt: Date
}

/**
 * Create a new draft
 */
export async function createDraft(
  phoneNumber: string,
  type: DraftType,
  content: string,
  structuredPayload: StructuredPayload | null = null
): Promise<AnnouncementDraftDB> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.create({
    data: {
      phoneNumber,
      draftText: content,
      structuredPayload: structuredPayload ? JSON.stringify(structuredPayload) : null,
      status: 'in_progress',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
  
  return {
    ...draft,
    structuredPayload: draft.structuredPayload ? JSON.parse(draft.structuredPayload) : null,
    status: draft.status as 'in_progress' | 'finalized'
  }
}

/**
 * Get active draft for a phone number
 */
export async function getActiveDraft(phoneNumber: string): Promise<Draft | null> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.findFirst({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!draft) return null
  
  // Convert to planner Draft format
  return {
    type: 'announcement', // We'll track type separately in the future
    content: draft.draftText,
    status: draft.status === 'in_progress' 
      ? (draft.draftText ? 'ready' : 'drafting')
      : 'sent',
    createdAt: draft.createdAt.getTime(),
    updatedAt: draft.updatedAt.getTime()
  }
}

/**
 * Update an existing draft
 */
export async function updateDraft(
  id: string,
  updates: {
    draftText?: string
    structuredPayload?: StructuredPayload | null
    status?: 'in_progress' | 'finalized'
  }
): Promise<AnnouncementDraftDB> {
  const prisma = await getPrisma()
  
  const draft = await prisma.announcementDraft.update({
    where: { id },
    data: {
      ...(updates.draftText !== undefined && { draftText: updates.draftText }),
      ...(updates.structuredPayload !== undefined && {
        structuredPayload: updates.structuredPayload 
          ? JSON.stringify(updates.structuredPayload) 
          : null
      }),
      ...(updates.status && { status: updates.status }),
      updatedAt: new Date()
    }
  })
  
  return {
    ...draft,
    structuredPayload: draft.structuredPayload ? JSON.parse(draft.structuredPayload) : null,
    status: draft.status as 'in_progress' | 'finalized'
  }
}

/**
 * Update draft by phone number
 */
export async function updateDraftByPhone(
  phoneNumber: string,
  updates: {
    draftText?: string
    structuredPayload?: StructuredPayload | null
    status?: 'in_progress' | 'finalized'
  }
): Promise<AnnouncementDraftDB | null> {
  const prisma = await getPrisma()
  
  const existingDraft = await prisma.announcementDraft.findFirst({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!existingDraft) return null
  
  return updateDraft(existingDraft.id, updates)
}

/**
 * Mark draft as finalized
 */
export async function finalizeDraft(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.announcementDraft.updateMany({
    where: {
      phoneNumber,
      status: 'in_progress'
    },
    data: {
      status: 'finalized',
      updatedAt: new Date()
    }
  })
}

/**
 * Delete draft
 */
export async function deleteDraft(phoneNumber: string): Promise<void> {
  const prisma = await getPrisma()
  
  await prisma.announcementDraft.deleteMany({
    where: {
      phoneNumber,
      status: 'in_progress'
    }
  })
}

/**
 * Clear stale drafts (older than 24 hours)
 */
export async function clearStaleDrafts(): Promise<number> {
  const prisma = await getPrisma()
  
  const oneDayAgo = new Date()
  oneDayAgo.setDate(oneDayAgo.getDate() - 1)
  
  const result = await prisma.announcementDraft.deleteMany({
    where: {
      status: 'in_progress',
      createdAt: {
        lt: oneDayAgo
      }
    }
  })
  
  return result.count
}



