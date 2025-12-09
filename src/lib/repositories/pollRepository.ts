/**
 * Poll Repository
 * Manages poll creation and response tracking
 */

import { getPrisma } from '@/lib/prisma'

export interface PollMeta {
  id: string
  questionText: string
  requiresReasonForNo: boolean
  isActive: boolean
  createdBy: string
  createdAt: Date
}

export interface PollResponse {
  id: string
  pollId: string
  phoneNumber: string
  response: 'Yes' | 'No' | 'Maybe'
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

export interface PollWithResponses extends PollMeta {
  responses: PollResponse[]
}

/**
 * Create a new poll (deactivates previous ones)
 */
export async function createPoll(
  questionText: string,
  createdBy: string,
  requiresReasonForNo: boolean = false
): Promise<PollMeta> {
  const prisma = await getPrisma()

  // Deactivate prior polls
  await prisma.pollMeta.updateMany({
    where: { isActive: true },
    data: { isActive: false }
  })

  // Create new poll
  const poll = await prisma.pollMeta.create({
    data: {
      questionText,
      requiresReasonForNo,
      isActive: true,
      createdBy,
      createdAt: new Date()
    }
  })

  return poll
}

/**
 * Get active poll
 */
export async function getActivePoll(): Promise<PollMeta | null> {
  const prisma = await getPrisma()

  return prisma.pollMeta.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Get poll by ID
 */
export async function getPollById(pollId: string): Promise<PollMeta | null> {
  const prisma = await getPrisma()
  return prisma.pollMeta.findUnique({ where: { id: pollId } })
}

/**
 * Get poll with responses
 */
export async function getPollWithResponses(pollId: string): Promise<PollWithResponses | null> {
  const prisma = await getPrisma()

  const poll = await prisma.pollMeta.findUnique({
    where: { id: pollId },
    include: { responses: { orderBy: { createdAt: 'asc' } } }
  })

  if (!poll) return null

  return {
    ...poll,
    responses: poll.responses.map((r) => ({
      ...r,
      response: r.response as 'Yes' | 'No' | 'Maybe'
    }))
  }
}

/**
 * Save or update a poll response
 */
export async function savePollResponse(
  pollId: string,
  phoneNumber: string,
  response: 'Yes' | 'No' | 'Maybe',
  notes: string | null = null
): Promise<PollResponse> {
  const prisma = await getPrisma()

  const existing = await prisma.pollResponse.findUnique({
    where: { pollId_phoneNumber: { pollId, phoneNumber } }
  })

  if (existing) {
    return prisma.pollResponse.update({
      where: { pollId_phoneNumber: { pollId, phoneNumber } },
      data: { response, notes }
    })
  }

  return prisma.pollResponse.create({
    data: {
      pollId,
      phoneNumber,
      response,
      notes
    }
  })
}

/**
 * Get responses for a poll
 */
export async function getPollResponses(pollId: string): Promise<PollResponse[]> {
  const prisma = await getPrisma()
  return prisma.pollResponse.findMany({
    where: { pollId },
    orderBy: { createdAt: 'asc' }
  })
}

/**
 * Get response summary for a poll
 */
export async function getPollResponseSummary(pollId: string): Promise<{
  yes: number
  no: number
  maybe: number
  total: number
}> {
  const responses = await getPollResponses(pollId)

  const summary = {
    yes: 0,
    no: 0,
    maybe: 0,
    total: responses.length
  }

  responses.forEach((r) => {
    const res = r.response.toLowerCase()
    if (res === 'yes') summary.yes++
    else if (res === 'no') summary.no++
    else if (res === 'maybe') summary.maybe++
  })

  return summary
}

/**
 * Mark poll as inactive
 */
export async function deactivatePoll(pollId: string): Promise<void> {
  const prisma = await getPrisma()
  await prisma.pollMeta.update({
    where: { id: pollId },
    data: { isActive: false }
  })
}
