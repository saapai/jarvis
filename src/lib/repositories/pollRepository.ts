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
  pollIdentifier?: string  // Progressive ID like "1.0", "1.1"
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
 * Generate next progressive poll ID (1.0, 1.1, 1.2, etc.)
 */
async function getNextPollId(): Promise<string> {
  const prisma = await getPrisma()
  
  // Count all polls ever created
  const totalPolls = await prisma.pollMeta.count()
  
  // Format: 1.0, 1.1, 1.2, etc.
  const majorVersion = Math.floor(totalPolls / 10) + 1
  const minorVersion = totalPolls % 10
  
  return `${majorVersion}.${minorVersion}`
}

/**
 * Create a new poll (deactivates previous ones)
 */
export async function createPoll(
  questionText: string,
  createdBy: string,
  requiresReasonForNo: boolean = false
): Promise<PollMeta & { pollIdentifier: string }> {
  const prisma = await getPrisma()

  const pollIdentifier = await getNextPollId()
  console.log(`[PollRepo] Creating poll with identifier: ${pollIdentifier}`)

  // Deactivate prior polls
  await prisma.pollMeta.updateMany({
    where: { isActive: true },
    data: { isActive: false }
  })

  // Create new poll
  console.log(`[PollRepo] Creating poll with requiresReasonForNo=${requiresReasonForNo}`)
  const poll = await prisma.pollMeta.create({
    data: {
      questionText,
      requiresReasonForNo,
      isActive: true,
      createdBy,
      createdAt: new Date()
    }
  })
  console.log(`[PollRepo] Created poll id=${poll.id}, requiresReasonForNo=${poll.requiresReasonForNo}`)

  return {
    ...poll,
    pollIdentifier
  }
}

/**
 * Get active poll with pollIdentifier
 */
export async function getActivePoll(): Promise<(PollMeta & { pollIdentifier: string }) | null> {
  const prisma = await getPrisma()

  const poll = await prisma.pollMeta.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!poll) return null
  
  // Calculate poll identifier based on creation order
  const totalPollsBefore = await prisma.pollMeta.count({
    where: {
      createdAt: {
        lt: poll.createdAt
      }
    }
  })
  
  const majorVersion = Math.floor(totalPollsBefore / 10) + 1
  const minorVersion = totalPollsBefore % 10
  const pollIdentifier = `${majorVersion}.${minorVersion}`
  
  return {
    ...poll,
    pollIdentifier
  }
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
function getPollFieldNames(pollId: string): {
  questionField: string
  responseField: string
  notesField: string
} {
  // Use progressive poll IDs (1.0, 1.1, 1.2, etc.)
  return {
    questionField: `POLL_Q_${pollId}`,
    responseField: `POLL_R_${pollId}`,
    notesField: `POLL_N_${pollId}`
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

  // Get the poll to retrieve the question text and calculate identifier
  const poll = await prisma.pollMeta.findUnique({ where: { id: pollId } })
  
  if (!poll) {
    throw new Error(`Poll ${pollId} not found`)
  }
  
  // Calculate poll identifier for Airtable field names
  const totalPollsBefore = await prisma.pollMeta.count({
    where: {
      createdAt: {
        lt: poll.createdAt
      }
    }
  })
  
  const majorVersion = Math.floor(totalPollsBefore / 10) + 1
  const minorVersion = totalPollsBefore % 10
  const pollIdentifier = `${majorVersion}.${minorVersion}`

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

  // Sync to Airtable (fields should already exist from poll creation)
  try {
    const user = await getUserByPhone(phoneNumber)
    if (user) {
      const fieldNames = getPollFieldNames(pollIdentifier)
      
      const airtableUpdate: Record<string, unknown> = {
        [fieldNames.questionField]: poll.questionText,
        [fieldNames.responseField]: response,
        [fieldNames.notesField]: notes || ''
      }
      
      console.log(`[PollRepo] Syncing poll response to Airtable for user ${user.id}`)
      await updateUser(user.id, airtableUpdate)
      console.log(`[PollRepo] Successfully synced poll response to Airtable`)
    }
  } catch (airtableError) {
    console.error(`[PollRepo] Airtable sync failed (non-critical):`, airtableError)
  }

  return pollResponse
}

/**
 * Get a specific user's response to a poll
 */
export async function getPollResponse(pollId: string, phoneNumber: string): Promise<PollResponse | null> {
  const prisma = await getPrisma()
  const response = await prisma.pollResponse.findUnique({
    where: { pollId_phoneNumber: { pollId, phoneNumber } }
  })

  return response ? normalizePollResponse(response) : null
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
