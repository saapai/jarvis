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
 * Create a new poll
 */
export async function createPoll(
  questionText: string,
  createdBy: string,
  requiresReasonForNo: boolean = false
): Promise<PollMeta> {
  const prisma = await getPrisma()
  
  // Mark all previous polls as inactive
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
  
  return await prisma.pollMeta.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Get poll by ID
 */
export async function getPollById(pollId: string): Promise<PollMeta | null> {
  const prisma = await getPrisma()
  
  return await prisma.pollMeta.findUnique({
    where: { id: pollId }
  })
}

/**
 * Get poll with all responses
 */
export async function getPollWithResponses(pollId: string): Promise<PollWithResponses | null> {
  const prisma = await getPrisma()
  
  const poll = await prisma.pollMeta.findUnique({
    where: { id: pollId },
    include: {
      responses: {
        orderBy: { createdAt: 'asc' }
      }
    }
  })
  
  if (!poll) return null
  
  return {
    ...poll,
    responses: poll.responses.map(r => ({
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
  
  const pollResponse = await prisma.pollResponse.upsert({
    where: {
      pollId_phoneNumber: {
        pollId,
        phoneNumber
      }
    },
    update: {
      response,
      notes,
      updatedAt: new Date()
    },
    create: {
      pollId,
      phoneNumber,
      response,
      notes,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
  
  return {
    ...pollResponse,
    response: pollResponse.response as 'Yes' | 'No' | 'Maybe'
  }
}

/**
 * Get user's response to a poll
 */
export async function getUserPollResponse(
  pollId: string,
  phoneNumber: string
): Promise<PollResponse | null> {
  const prisma = await getPrisma()
  
  const response = await prisma.pollResponse.findUnique({
    where: {
      pollId_phoneNumber: {
        pollId,
        phoneNumber
      }
    }
  })
  
  if (!response) return null
  
  return {
    ...response,
    response: response.response as 'Yes' | 'No' | 'Maybe'
  }
}

/**
 * Get all responses for a poll
 */
export async function getPollResponses(pollId: string): Promise<PollResponse[]> {
  const prisma = await getPrisma()
  
  const responses = await prisma.pollResponse.findMany({
    where: { pollId },
    orderBy: { createdAt: 'asc' }
  })
  
  return responses.map(r => ({
    ...r,
    response: r.response as 'Yes' | 'No' | 'Maybe'
  }))
}

/**
 * Get response summary for a poll
 */
export async function getPollSummary(pollId: string): Promise<{
  yes: number
  no: number
  maybe: number
  total: number
}> {
  const prisma = await getPrisma()
  
  const responses = await prisma.pollResponse.findMany({
    where: { pollId },
    select: { response: true }
  })
  
  const summary = {
    yes: 0,
    no: 0,
    maybe: 0,
    total: responses.length
  }
  
  responses.forEach(r => {
    const response = r.response.toLowerCase()
    if (response === 'yes') summary.yes++
    else if (response === 'no') summary.no++
    else if (response === 'maybe') summary.maybe++
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
 * Create a new poll
 */
export async function createPoll(
  questionText: string,
  createdBy: string,
  requiresReasonForNo: boolean = false
): Promise<PollMeta> {
  const prisma = await getPrisma()
  
  // Mark all previous polls as inactive
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
  
  return await prisma.pollMeta.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Get poll by ID
 */
export async function getPollById(pollId: string): Promise<PollMeta | null> {
  const prisma = await getPrisma()
  
  return await prisma.pollMeta.findUnique({
    where: { id: pollId }
  })
}

/**
 * Get poll with all responses
 */
export async function getPollWithResponses(pollId: string): Promise<PollWithResponses | null> {
  const prisma = await getPrisma()
  
  const poll = await prisma.pollMeta.findUnique({
    where: { id: pollId },
    include: {
      responses: {
        orderBy: { createdAt: 'asc' }
      }
    }
  })
  
  if (!poll) return null
  
  return {
    ...poll,
    responses: poll.responses.map(r => ({
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
  
  const pollResponse = await prisma.pollResponse.upsert({
    where: {
      pollId_phoneNumber: {
        pollId,
        phoneNumber
      }
    },
    update: {
      response,
      notes,
      updatedAt: new Date()
    },
    create: {
      pollId,
      phoneNumber,
      response,
      notes,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
  
  return {
    ...pollResponse,
    response: pollResponse.response as 'Yes' | 'No' | 'Maybe'
  }
}

/**
 * Get user's response to a poll
 */
export async function getUserPollResponse(
  pollId: string,
  phoneNumber: string
): Promise<PollResponse | null> {
  const prisma = await getPrisma()
  
  const response = await prisma.pollResponse.findUnique({
    where: {
      pollId_phoneNumber: {
        pollId,
        phoneNumber
      }
    }
  })
  
  if (!response) return null
  
  return {
    ...response,
    response: response.response as 'Yes' | 'No' | 'Maybe'
  }
}

/**
 * Get all responses for a poll
 */
export async function getPollResponses(pollId: string): Promise<PollResponse[]> {
  const prisma = await getPrisma()
  
  const responses = await prisma.pollResponse.findMany({
    where: { pollId },
    orderBy: { createdAt: 'asc' }
  })
  
  return responses.map(r => ({
    ...r,
    response: r.response as 'Yes' | 'No' | 'Maybe'
  }))
}

/**
 * Get response summary for a poll
 */
export async function getPollSummary(pollId: string): Promise<{
  yes: number
  no: number
  maybe: number
  total: number
}> {
  const prisma = await getPrisma()
  
  const responses = await prisma.pollResponse.findMany({
    where: { pollId },
    select: { response: true }
  })
  
  const summary = {
    yes: 0,
    no: 0,
    maybe: 0,
    total: responses.length
  }
  
  responses.forEach(r => {
    const response = r.response.toLowerCase()
    if (response === 'yes') summary.yes++
    else if (response === 'no') summary.no++
    else if (response === 'maybe') summary.maybe++
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
 * Create a new poll
 */
export async function createPoll(
  questionText: string,
  createdBy: string,
  requiresReasonForNo: boolean = false
): Promise<PollMeta> {
  const prisma = await getPrisma()
  
  // Mark all previous polls as inactive
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
  
  return await prisma.pollMeta.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Get poll by ID
 */
export async function getPollById(pollId: string): Promise<PollMeta | null> {
  const prisma = await getPrisma()
  
  return await prisma.pollMeta.findUnique({
    where: { id: pollId }
  })
}

/**
 * Get poll with all responses
 */
export async function getPollWithResponses(pollId: string): Promise<PollWithResponses | null> {
  const prisma = await getPrisma()
  
  const poll = await prisma.pollMeta.findUnique({
    where: { id: pollId },
    include: {
      responses: {
        orderBy: { createdAt: 'asc' }
      }
    }
  })
  
  if (!poll) return null
  
  return {
    ...poll,
    responses: poll.responses.map(r => ({
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
  
  const pollResponse = await prisma.pollResponse.upsert({
    where: {
      pollId_phoneNumber: {
        pollId,
        phoneNumber
      }
    },
    update: {
      response,
      notes,
      updatedAt: new Date()
    },
    create: {
      pollId,
      phoneNumber,
      response,
      notes,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
  
  return {
    ...pollResponse,
    response: pollResponse.response as 'Yes' | 'No' | 'Maybe'
  }
}

/**
 * Get user's response to a poll
 */
export async function getUserPollResponse(
  pollId: string,
  phoneNumber: string
): Promise<PollResponse | null> {
  const prisma = await getPrisma()
  
  const response = await prisma.pollResponse.findUnique({
    where: {
      pollId_phoneNumber: {
        pollId,
        phoneNumber
      }
    }
  })
  
  if (!response) return null
  
  return {
    ...response,
    response: response.response as 'Yes' | 'No' | 'Maybe'
  }
}

/**
 * Get all responses for a poll
 */
export async function getPollResponses(pollId: string): Promise<PollResponse[]> {
  const prisma = await getPrisma()
  
  const responses = await prisma.pollResponse.findMany({
    where: { pollId },
    orderBy: { createdAt: 'asc' }
  })
  
  return responses.map(r => ({
    ...r,
    response: r.response as 'Yes' | 'No' | 'Maybe'
  }))
}

/**
 * Get response summary for a poll
 */
export async function getPollSummary(pollId: string): Promise<{
  yes: number
  no: number
  maybe: number
  total: number
}> {
  const prisma = await getPrisma()
  
  const responses = await prisma.pollResponse.findMany({
    where: { pollId },
    select: { response: true }
  })
  
  const summary = {
    yes: 0,
    no: 0,
    maybe: 0,
    total: responses.length
  }
  
  responses.forEach(r => {
    const response = r.response.toLowerCase()
    if (response === 'yes') summary.yes++
    else if (response === 'no') summary.no++
    else if (response === 'maybe') summary.maybe++
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
 * Create a new poll
 */
export async function createPoll(
  questionText: string,
  createdBy: string,
  requiresReasonForNo: boolean = false
): Promise<PollMeta> {
  const prisma = await getPrisma()
  
  // Mark all previous polls as inactive
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
  
  return await prisma.pollMeta.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Get poll by ID
 */
export async function getPollById(pollId: string): Promise<PollMeta | null> {
  const prisma = await getPrisma()
  
  return await prisma.pollMeta.findUnique({
    where: { id: pollId }
  })
}

/**
 * Get poll with all responses
 */
export async function getPollWithResponses(pollId: string): Promise<PollWithResponses | null> {
  const prisma = await getPrisma()
  
  const poll = await prisma.pollMeta.findUnique({
    where: { id: pollId },
    include: {
      responses: {
        orderBy: { createdAt: 'asc' }
      }
    }
  })
  
  if (!poll) return null
  
  return {
    ...poll,
    responses: poll.responses.map(r => ({
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
  
  const pollResponse = await prisma.pollResponse.upsert({
    where: {
      pollId_phoneNumber: {
        pollId,
        phoneNumber
      }
    },
    update: {
      response,
      notes,
      updatedAt: new Date()
    },
    create: {
      pollId,
      phoneNumber,
      response,
      notes,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
  
  return {
    ...pollResponse,
    response: pollResponse.response as 'Yes' | 'No' | 'Maybe'
  }
}

/**
 * Get user's response to a poll
 */
export async function getUserPollResponse(
  pollId: string,
  phoneNumber: string
): Promise<PollResponse | null> {
  const prisma = await getPrisma()
  
  const response = await prisma.pollResponse.findUnique({
    where: {
      pollId_phoneNumber: {
        pollId,
        phoneNumber
      }
    }
  })
  
  if (!response) return null
  
  return {
    ...response,
    response: response.response as 'Yes' | 'No' | 'Maybe'
  }
}

/**
 * Get all responses for a poll
 */
export async function getPollResponses(pollId: string): Promise<PollResponse[]> {
  const prisma = await getPrisma()
  
  const responses = await prisma.pollResponse.findMany({
    where: { pollId },
    orderBy: { createdAt: 'asc' }
  })
  
  return responses.map(r => ({
    ...r,
    response: r.response as 'Yes' | 'No' | 'Maybe'
  }))
}

/**
 * Get response summary for a poll
 */
export async function getPollSummary(pollId: string): Promise<{
  yes: number
  no: number
  maybe: number
  total: number
}> {
  const prisma = await getPrisma()
  
  const responses = await prisma.pollResponse.findMany({
    where: { pollId },
    select: { response: true }
  })
  
  const summary = {
    yes: 0,
    no: 0,
    maybe: 0,
    total: responses.length
  }
  
  responses.forEach(r => {
    const response = r.response.toLowerCase()
    if (response === 'yes') summary.yes++
    else if (response === 'no') summary.no++
    else if (response === 'maybe') summary.maybe++
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
 * Create a new poll
 */
export async function createPoll(
  questionText: string,
  createdBy: string,
  requiresReasonForNo: boolean = false
): Promise<PollMeta> {
  const prisma = await getPrisma()
  
  // Mark all previous polls as inactive
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
  
  return await prisma.pollMeta.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Get poll by ID
 */
export async function getPollById(pollId: string): Promise<PollMeta | null> {
  const prisma = await getPrisma()
  
  return await prisma.pollMeta.findUnique({
    where: { id: pollId }
  })
}

/**
 * Get poll with all responses
 */
export async function getPollWithResponses(pollId: string): Promise<PollWithResponses | null> {
  const prisma = await getPrisma()
  
  const poll = await prisma.pollMeta.findUnique({
    where: { id: pollId },
    include: {
      responses: {
        orderBy: { createdAt: 'asc' }
      }
    }
  })
  
  if (!poll) return null
  
  return {
    ...poll,
    responses: poll.responses.map(r => ({
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
  
  const pollResponse = await prisma.pollResponse.upsert({
    where: {
      pollId_phoneNumber: {
        pollId,
        phoneNumber
      }
    },
    update: {
      response,
      notes,
      updatedAt: new Date()
    },
    create: {
      pollId,
      phoneNumber,
      response,
      notes,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
  
  return {
    ...pollResponse,
    response: pollResponse.response as 'Yes' | 'No' | 'Maybe'
  }
}

/**
 * Get user's response to a poll
 */
export async function getUserPollResponse(
  pollId: string,
  phoneNumber: string
): Promise<PollResponse | null> {
  const prisma = await getPrisma()
  
  const response = await prisma.pollResponse.findUnique({
    where: {
      pollId_phoneNumber: {
        pollId,
        phoneNumber
      }
    }
  })
  
  if (!response) return null
  
  return {
    ...response,
    response: response.response as 'Yes' | 'No' | 'Maybe'
  }
}

/**
 * Get all responses for a poll
 */
export async function getPollResponses(pollId: string): Promise<PollResponse[]> {
  const prisma = await getPrisma()
  
  const responses = await prisma.pollResponse.findMany({
    where: { pollId },
    orderBy: { createdAt: 'asc' }
  })
  
  return responses.map(r => ({
    ...r,
    response: r.response as 'Yes' | 'No' | 'Maybe'
  }))
}

/**
 * Get response summary for a poll
 */
export async function getPollSummary(pollId: string): Promise<{
  yes: number
  no: number
  maybe: number
  total: number
}> {
  const prisma = await getPrisma()
  
  const responses = await prisma.pollResponse.findMany({
    where: { pollId },
    select: { response: true }
  })
  
  const summary = {
    yes: 0,
    no: 0,
    maybe: 0,
    total: responses.length
  }
  
  responses.forEach(r => {
    const response = r.response.toLowerCase()
    if (response === 'yes') summary.yes++
    else if (response === 'no') summary.no++
    else if (response === 'maybe') summary.maybe++
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



