/**
 * Jest setup
 * - Loads .env.local/.env (same precedence as Next.js) so LLM-backed tests can run
 * - Replaces the repository layer with in-memory doubles so tests never touch a real DB
 */
import * as fs from 'fs'
import * as path from 'path'

// @next/env skips .env.local under NODE_ENV=test, so parse env files directly.
// Precedence matches Next.js: .env.local wins over .env; existing env wins over both.
for (const file of ['.env.local', '.env']) {
  const fullPath = path.join(__dirname, file)
  if (!fs.existsSync(fullPath)) continue
  for (const line of fs.readFileSync(fullPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^["']|["']$/g, '')
  }
}

if (!process.env.OPENAI_API_KEY) {
  // Classifier/scenario suites exercise the live LLM pipeline and will fail without a key.
  // Use `npm run test:unit` for the deterministic suites.
  console.warn('[jest.setup] OPENAI_API_KEY not set — LLM-dependent suites will fail')
}

jest.setTimeout(30000)

// ============================================
// In-memory repository doubles
// ============================================

jest.mock('@/lib/repositories/draftRepository', () => {
  type StoredDraft = {
    phoneNumber: string
    draftText: string
    structuredPayload: Record<string, unknown> | null
    status: 'in_progress' | 'finalized'
    spaceId: string | null
    createdAt: Date
    updatedAt: Date
  }
  let drafts: StoredDraft[] = []

  const toPlannerDraft = (d: StoredDraft) => ({
    type: 'announcement' as const,
    content: d.draftText,
    status: d.draftText ? ('ready' as const) : ('drafting' as const),
    createdAt: d.createdAt.getTime(),
    updatedAt: d.updatedAt.getTime(),
    requiresExcuse: false,
    pendingMandatory: false,
    links: (d.structuredPayload?.links as string[] | undefined) || []
  })

  const findActive = (phoneNumber: string) =>
    drafts.find((d) => d.phoneNumber === phoneNumber && d.status === 'in_progress')

  return {
    __reset: () => { drafts = [] },
    createDraft: jest.fn(async (phoneNumber: string, type: string, content: string, structuredPayload: Record<string, unknown> | null = null, spaceId?: string | null) => {
      // Mirror prod behaviour: one active draft per phone
      drafts = drafts.filter((d) => !(d.phoneNumber === phoneNumber && d.status === 'in_progress'))
      const draft: StoredDraft = {
        phoneNumber,
        draftText: content,
        structuredPayload: { ...structuredPayload, type },
        status: 'in_progress',
        spaceId: spaceId || null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      drafts.push(draft)
      return { ...draft }
    }),
    getActiveDraft: jest.fn(async (phoneNumber: string) => {
      const d = findActive(phoneNumber)
      return d ? toPlannerDraft(d) : null
    }),
    updateDraft: jest.fn(async () => undefined),
    updateDraftByPhone: jest.fn(async (phoneNumber: string, updates: { draftText?: string }) => {
      const d = findActive(phoneNumber)
      if (d) {
        if (typeof updates.draftText === 'string') d.draftText = updates.draftText
        d.updatedAt = new Date()
      }
    }),
    finalizeDraft: jest.fn(async (phoneNumber: string) => {
      const d = findActive(phoneNumber)
      if (d) d.status = 'finalized'
    }),
    deleteDraft: jest.fn(async (phoneNumber: string) => {
      drafts = drafts.filter((d) => !(d.phoneNumber === phoneNumber && d.status === 'in_progress'))
    }),
    clearStaleDrafts: jest.fn(async () => 0)
  }
})

jest.mock('@/lib/repositories/messageRepository', () => {
  type StoredMessage = {
    id: string
    phoneNumber: string
    direction: 'inbound' | 'outbound'
    text: string
    meta: Record<string, unknown> | null
    spaceId: string | null
    createdAt: Date
  }
  let messages: StoredMessage[] = []
  let nextId = 1

  return {
    __reset: () => { messages = []; nextId = 1 },
    logMessage: jest.fn(async (phoneNumber: string, direction: 'inbound' | 'outbound', text: string, meta: Record<string, unknown> | null = null, spaceId?: string | null) => {
      const msg: StoredMessage = {
        id: String(nextId++),
        phoneNumber,
        direction,
        text,
        meta,
        spaceId: spaceId || null,
        createdAt: new Date()
      }
      messages.push(msg)
      return msg
    }),
    getRecentMessages: jest.fn(async (phoneNumber: string, limit: number = 10) => {
      return messages.filter((m) => m.phoneNumber === phoneNumber).slice(-limit)
    }),
    getAllMessages: jest.fn(async (phoneNumber: string) => {
      return messages.filter((m) => m.phoneNumber === phoneNumber)
    }),
    deleteOldMessages: jest.fn(async () => 0),
    getPastActions: jest.fn(async () => [])
  }
})

jest.mock('@/lib/repositories/eventRepository', () => ({
  __reset: () => undefined,
  createEvent: jest.fn(async (params: Record<string, unknown>) => ({ id: 'evt_test', ...params })),
  getEventsNeedingMorningReminder: jest.fn(async () => []),
  getEventsNeeding2HourReminder: jest.fn(async () => []),
  markMorningReminderSent: jest.fn(async () => undefined),
  mark2HourReminderSent: jest.fn(async () => undefined),
  getUpcomingEvents: jest.fn(async () => []),
  getPastEvents: jest.fn(async () => []),
  updateEvent: jest.fn(async (eventId: string, updates: Record<string, unknown>) => ({ id: eventId, title: 'test event', eventDate: new Date(), ...updates })),
  deleteEvent: jest.fn(async () => undefined)
}))

jest.mock('@/lib/repositories/memberRepository', () => ({
  __reset: () => undefined,
  getMember: jest.fn(async () => null),
  createMember: jest.fn(async () => null),
  updateMember: jest.fn(async () => undefined),
  getAllMembers: jest.fn(async () => []),
  getOptedInMembers: jest.fn(async () => []),
  setNeedsName: jest.fn(async () => undefined),
  updateMemberName: jest.fn(async () => undefined),
  setOptedOut: jest.fn(async () => undefined),
  isAdmin: jest.fn(() => false)
}))

beforeEach(() => {
  // Optional chaining: suites that define their own repository mocks won't have __reset
  /* eslint-disable @typescript-eslint/no-var-requires */
  require('@/lib/repositories/draftRepository').__reset?.()
  require('@/lib/repositories/messageRepository').__reset?.()
  /* eslint-enable @typescript-eslint/no-var-requires */
})
