/**
 * Poll Repository
 * Manages poll creation and response tracking
 * Syncs poll responses to Airtable
 */

import { getPrisma } from '@/lib/prisma'
import { updateUser, getUserByPhone } from '@/lib/db'

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
 * Generate Airtable field names for a poll
 */
function getPollFieldNames(questionText: string): {
  questionField: string
  responseField: string
  notesField: string
} {
  // Use fixed field names that can be reused for each poll
  // (Airtable API doesn't support creating fields programmatically)
  return {
    questionField: 'POLL_LATEST_Q',
    responseField: 'POLL_LATEST_R',
    notesField: 'POLL_LATEST_N'
  }
}

/**
 * Save or update a poll response
 * Saves to both Prisma database and Airtable
 */
export async function savePollResponse(
  pollId: string,
  phoneNumber: string,
  response: 'Yes' | 'No' | 'Maybe',
  notes: string | null = null
): Promise<PollResponse> {
  const prisma = await getPrisma()

  // Get the poll to retrieve the question text
  const poll = await prisma.pollMeta.findUnique({ where: { id: pollId } })
  
  if (!poll) {
    throw new Error(`Poll ${pollId} not found`)
  }

  // Save to Prisma database
  const existing = await prisma.pollResponse.findUnique({
    where: { pollId_phoneNumber: { pollId, phoneNumber } }
  })

  let pollResponse: PollResponse
  if (existing) {
    const updated = await prisma.pollResponse.update({
      where: { pollId_phoneNumber: { pollId, phoneNumber } },
      data: { response, notes }
    })
    pollResponse = normalizePollResponse(updated)
  } else {
    const created = await prisma.pollResponse.create({
      data: {
        pollId,
        phoneNumber,
        response,
        notes
      }
    })
    pollResponse = normalizePollResponse(created)
  }

  // Sync to Airtable
  try {
    const user = await getUserByPhone(phoneNumber)
    if (user) {
      const fieldNames = getPollFieldNames(poll.questionText)
      
      const airtableUpdate: Record<string, unknown> = {
        [fieldNames.questionField]: poll.questionText,
        [fieldNames.responseField]: response,
        [fieldNames.notesField]: notes || ''
      }
      
      console.log(`[PollRepo] Syncing poll response to Airtable for user ${user.id}:`, airtableUpdate)
      await updateUser(user.id, airtableUpdate)
      console.log(`[PollRepo] Successfully synced poll response to Airtable`)
    } else {
      console.warn(`[PollRepo] User not found in Airtable for phone ${phoneNumber}, skipping Airtable sync`)
    }
  } catch (airtableError) {
    console.error(`[PollRepo] Failed to sync poll response to Airtable:`, airtableError)
    // Don't fail the whole operation if Airtable sync fails
  }

  return pollResponse
}

/**
 * Get responses for a poll
 */
export async function getPollResponses(pollId: string): Promise<PollResponse[]> {
  const prisma = await getPrisma()
  const responses = await prisma.pollResponse.findMany({
    where: { pollId },
    orderBy: { createdAt: 'asc' }
  })

  return responses.map(normalizePollResponse)
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

/**
 * Sync all poll responses to Airtable
 * Useful for ensuring data consistency
 */
export async function syncPollResponsesToAirtable(pollId: string): Promise<{ synced: number; failed: number }> {
  const prisma = await getPrisma()
  
  const poll = await prisma.pollMeta.findUnique({ where: { id: pollId } })
  if (!poll) {
    throw new Error(`Poll ${pollId} not found`)
  }
  
  const responses = await prisma.pollResponse.findMany({ where: { pollId } })
  const fieldNames = getPollFieldNames(poll.questionText)
  
  let synced = 0
  let failed = 0
  
  for (const response of responses) {
    try {
      const user = await getUserByPhone(response.phoneNumber)
      if (user) {
        const airtableUpdate: Record<string, unknown> = {
          [fieldNames.questionField]: poll.questionText,
          [fieldNames.responseField]: response.response,
          [fieldNames.notesField]: response.notes || ''
        }
        
        await updateUser(user.id, airtableUpdate)
        synced++
      } else {
        console.warn(`[PollRepo] User not found for ${response.phoneNumber}`)
        failed++
      }
    } catch (error) {
      console.error(`[PollRepo] Failed to sync response for ${response.phoneNumber}:`, error)
      failed++
    }
  }
  
  console.log(`[PollRepo] Synced ${synced} responses, ${failed} failed`)
  return { synced, failed }
}

function normalizePollResponse(record: {
  id: string
  createdAt: Date
  updatedAt: Date
  phoneNumber: string
  response: string
  pollId: string
  notes: string | null
}): PollResponse {
  const resp = record.response.toLowerCase()
  const normalized: 'Yes' | 'No' | 'Maybe' =
    resp === 'yes' ? 'Yes' : resp === 'no' ? 'No' : 'Maybe'

  return {
    id: record.id,
    pollId: record.pollId,
    phoneNumber: record.phoneNumber,
    response: normalized,
    notes: record.notes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
}
