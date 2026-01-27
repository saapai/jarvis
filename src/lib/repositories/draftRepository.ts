/**
 * Draft Repository
 * Manages announcement and poll drafts
 */

import { getPrisma } from '@/lib/prisma'
import type { Draft, DraftType } from '@/lib/planner/types'

export interface StructuredPayload {
  type?: 'announcement' | 'poll'  // Track draft type
  requiresExcuse?: boolean         // For polls: require notes if answering "No"
  pendingMandatory?: boolean       // For polls: waiting for mandatory confirmation
  links?: string[]                 // Extracted links
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
  spaceId?: string | null
}

/**
 * Create a new draft
 * @param spaceId - Optional space ID for multi-tenant support
 */
export async function createDraft(
  phoneNumber: string,
  type: DraftType,
  content: string,
  structuredPayload: StructuredPayload | null = null,
  spaceId?: string | null
): Promise<AnnouncementDraftDB> {
  const prisma = await getPrisma()

  // Ensure type is stored in payload
  const payloadWithType: StructuredPayload = {
    ...structuredPayload,
    type
  }

  const draft = await prisma.announcementDraft.create({
    data: {
      phoneNumber,
      draftText: content,
      structuredPayload: JSON.stringify(payloadWithType),
      status: 'in_progress',
      spaceId: spaceId || null,
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
 * @param spaceId - Optional space ID to filter drafts
 */
export async function getActiveDraft(phoneNumber: string, spaceId?: string | null): Promise<Draft | null> {
  const prisma = await getPrisma()

  const where: { phoneNumber: string; status: string; spaceId?: string | null } = {
    phoneNumber,
    status: 'in_progress'
  }
  if (spaceId !== undefined) {
    where.spaceId = spaceId
  }

  const draft = await prisma.announcementDraft.findFirst({
    where,
    orderBy: { createdAt: 'desc' }
  })

  if (!draft) return null

  // Parse structured payload to get type and requiresExcuse
  const payload: StructuredPayload = draft.structuredPayload 
    ? JSON.parse(draft.structuredPayload) 
    : {}
  
  const draftType = payload.type || 'announcement' // Default to announcement for backwards compatibility

  // Convert to planner Draft format
  return {
    type: draftType,
    content: draft.draftText,
    status: draft.draftText ? 'ready' : 'drafting',
    createdAt: draft.createdAt.getTime(),
    updatedAt: draft.updatedAt.getTime(),
    requiresExcuse: payload.requiresExcuse || false,
    pendingMandatory: payload.pendingMandatory || false,
    links: payload.links || []
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
        structuredPayload: updates.structuredPayload ? JSON.stringify(updates.structuredPayload) : null
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
 * @param spaceId - Optional space ID to filter drafts
 */
export async function updateDraftByPhone(
  phoneNumber: string,
  updates: {
    draftText?: string
    structuredPayload?: StructuredPayload | null
    status?: 'in_progress' | 'finalized'
  },
  spaceId?: string | null
): Promise<AnnouncementDraftDB | null> {
  const prisma = await getPrisma()

  const where: { phoneNumber: string; status: string; spaceId?: string | null } = {
    phoneNumber,
    status: 'in_progress'
  }
  if (spaceId !== undefined) {
    where.spaceId = spaceId
  }

  const existingDraft = await prisma.announcementDraft.findFirst({
    where,
    orderBy: { createdAt: 'desc' }
  })

  if (!existingDraft) return null
  return updateDraft(existingDraft.id, updates)
}

/**
 * Mark draft as finalized
 * @param spaceId - Optional space ID to filter drafts
 */
export async function finalizeDraft(phoneNumber: string, spaceId?: string | null): Promise<void> {
  const prisma = await getPrisma()

  const where: { phoneNumber: string; status: string; spaceId?: string | null } = {
    phoneNumber,
    status: 'in_progress'
  }
  if (spaceId !== undefined) {
    where.spaceId = spaceId
  }

  await prisma.announcementDraft.updateMany({
    where,
    data: { status: 'finalized', updatedAt: new Date() }
  })
}

/**
 * Delete draft
 * @param spaceId - Optional space ID to filter drafts
 */
export async function deleteDraft(phoneNumber: string, spaceId?: string | null): Promise<void> {
  const prisma = await getPrisma()

  const where: { phoneNumber: string; status: string; spaceId?: string | null } = {
    phoneNumber,
    status: 'in_progress'
  }
  if (spaceId !== undefined) {
    where.spaceId = spaceId
  }

  await prisma.announcementDraft.deleteMany({ where })
}

/**
 * Clear stale drafts (older than 24 hours)
 */
export async function clearStaleDrafts(): Promise<number> {
  const prisma = await getPrisma()

  const oneDayAgo = new Date()
  oneDayAgo.setDate(oneDayAgo.getDate() - 1)

  const result = await prisma.announcementDraft.deleteMany({
    where: { status: 'in_progress', createdAt: { lt: oneDayAgo } }
  })

  return result.count
}
