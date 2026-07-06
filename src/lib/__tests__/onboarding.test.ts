/**
 * Onboarding Test Suite
 *
 * Tests the full first-text experience: from a brand-new phone number texting
 * the bot through name collection, welcome messages, system commands, and
 * the transition into normal conversation.
 *
 * Tests are organized by stage:
 *   1. Brand-new user (no account)
 *   2. Name extraction (LLM-based)
 *   3. Onboarding prompts & welcome messages
 *   4. System commands during/after onboarding (STOP, START, HELP)
 *   5. Space JOIN flow
 *   6. Post-onboarding transition to normal conversation
 */

// ---------------------------------------------------------------------------
// Mocks — must be defined before imports
// ---------------------------------------------------------------------------

// OpenAI mock (used by extractName, classifyIntent, etc.)
const mockOpenAICreate = jest.fn()
const mockOpenAIConstructor = jest.fn().mockImplementation(() => ({
  chat: { completions: { create: mockOpenAICreate } },
}))
jest.mock('openai', () => ({
  __esModule: true,
  default: mockOpenAIConstructor,
}))

// Prisma mock
const mockPrismaCreate = jest.fn()
const mockPrismaFindUnique = jest.fn()
const mockPrismaFindMany = jest.fn()
const mockPrismaUpdateMany = jest.fn()
const mockPrismaUpsert = jest.fn()
jest.mock('@/lib/prisma', () => ({
  getPrisma: jest.fn().mockResolvedValue({
    message: {
      create: mockPrismaCreate,
      findMany: mockPrismaFindMany,
    },
    user: {
      findUnique: mockPrismaFindUnique,
      create: mockPrismaCreate,
    },
    spaceMember: {
      findUnique: mockPrismaFindUnique,
      updateMany: mockPrismaUpdateMany,
    },
    conversationState: {
      upsert: mockPrismaUpsert,
      findUnique: mockPrismaFindUnique,
    },
  }),
}))

// Twilio mock
jest.mock('@/lib/twilio', () => ({
  validateTwilioSignature: jest.fn().mockResolvedValue(true),
  toTwiml: jest.fn((msgs: string[]) => `<Response><Message>${msgs[0]}</Message></Response>`),
  sendSms: jest.fn().mockResolvedValue({ ok: true }),
}))

// Member repository mock
const mockGetMember = jest.fn()
const mockCreateMember = jest.fn()
const mockUpdateMemberName = jest.fn()
const mockIsAdmin = jest.fn()
const mockGetOptedInMembers = jest.fn()
const mockSetOptedOut = jest.fn()
jest.mock('@/lib/repositories/memberRepository', () => ({
  getMember: (...args: any[]) => mockGetMember(...args),
  createMember: (...args: any[]) => mockCreateMember(...args),
  updateMemberName: (...args: any[]) => mockUpdateMemberName(...args),
  updateMember: jest.fn().mockResolvedValue(true),
  isAdmin: (...args: any[]) => mockIsAdmin(...args),
  getOptedInMembers: (...args: any[]) => mockGetOptedInMembers(...args),
  setOptedOut: (...args: any[]) => mockSetOptedOut(...args),
}))

// Message repository mock
const mockLogMessage = jest.fn().mockResolvedValue({
  id: 'msg-1',
  phoneNumber: '1234567890',
  direction: 'outbound',
  text: '',
  meta: null,
  createdAt: new Date(),
})
const mockGetRecentMessages = jest.fn().mockResolvedValue([])
jest.mock('@/lib/repositories/messageRepository', () => ({
  logMessage: (...args: any[]) => mockLogMessage(...args),
  getRecentMessages: (...args: any[]) => mockGetRecentMessages(...args),
  getPastActions: jest.fn().mockResolvedValue([]),
}))

// Space context mock
const mockGetActiveSpaceId = jest.fn().mockResolvedValue(null)
const mockGetSpaceMember = jest.fn().mockResolvedValue(null)
const mockIsSpaceAdminByPhone = jest.fn().mockResolvedValue(false)
const mockGetUserSpacesByPhone = jest.fn().mockResolvedValue([])
const mockFindSpaceByJoinCode = jest.fn().mockResolvedValue(null)
const mockAddUserToSpace = jest.fn()
const mockSetActiveSpaceId = jest.fn()
const mockGetSpaceMembers = jest.fn().mockResolvedValue([])
const mockSetMemberOptedOut = jest.fn()
jest.mock('@/lib/spaceContext', () => ({
  getActiveSpaceId: (...args: any[]) => mockGetActiveSpaceId(...args),
  getSpaceMember: (...args: any[]) => mockGetSpaceMember(...args),
  isSpaceAdminByPhone: (...args: any[]) => mockIsSpaceAdminByPhone(...args),
  getUserSpacesByPhone: (...args: any[]) => mockGetUserSpacesByPhone(...args),
  findSpaceByJoinCode: (...args: any[]) => mockFindSpaceByJoinCode(...args),
  addUserToSpace: (...args: any[]) => mockAddUserToSpace(...args),
  setActiveSpaceId: (...args: any[]) => mockSetActiveSpaceId(...args),
  getSpaceMembers: (...args: any[]) => mockGetSpaceMembers(...args),
  setMemberOptedOut: (...args: any[]) => mockSetMemberOptedOut(...args),
}))

// Draft, poll, conversation, event repos — stub out
jest.mock('@/lib/repositories/draftRepository', () => ({
  getActiveDraft: jest.fn().mockResolvedValue(null),
  createDraft: jest.fn(),
  updateDraft: jest.fn(),
  setDraftReady: jest.fn(),
}))
jest.mock('@/lib/repositories/pollRepository', () => ({
  getActivePoll: jest.fn().mockResolvedValue(null),
  createPoll: jest.fn(),
  getPollResponse: jest.fn().mockResolvedValue(null),
  recordPollResponse: jest.fn(),
}))
jest.mock('@/lib/repositories/conversationRepository', () => ({
  getConversationState: jest.fn().mockResolvedValue(null),
  setConversationState: jest.fn(),
}))
jest.mock('@/lib/repositories/eventRepository', () => ({
  getUpcomingEvents: jest.fn().mockResolvedValue([]),
  getPastEvents: jest.fn().mockResolvedValue([]),
}))

// Content search — stub
jest.mock('@/text-explorer/router', () => ({
  routeContentSearch: jest.fn().mockResolvedValue([]),
}))

// DB helpers
jest.mock('@/lib/db', () => ({
  normalizePhone: (p: string) => p.replace(/[^\d]/g, '').slice(-10),
  toE164: (p: string) => `+1${p.replace(/[^\d]/g, '').slice(-10)}`,
  ensurePollFieldsExist: jest.fn().mockResolvedValue(true),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/twilio/sms/route'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake Twilio SMS webhook request */
function makeSmsRequest(body: string, from = '+11234567890'): NextRequest {
  const params = new URLSearchParams({ Body: body, From: from })
  return new NextRequest('http://localhost:3000/api/twilio/sms', {
    method: 'POST',
    body: params,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

/** Extract the text from the TwiML response */
async function getResponseText(request: NextRequest): Promise<string> {
  const response = await POST(request)
  const xml = await response.text()
  const match = xml.match(/<Message>([\s\S]*?)<\/Message>/)
  return match?.[1] || xml
}

/** Make the OpenAI mock return a name extraction result */
function mockNameExtraction(name: string | null) {
  mockOpenAICreate.mockResolvedValueOnce({
    choices: [{ message: { content: name || 'NOT_A_NAME' } }],
  })
}

/** Make the OpenAI mock return a classification result */
function mockClassification(action: string, confidence = 0.9) {
  mockOpenAICreate.mockResolvedValueOnce({
    choices: [{
      message: {
        content: JSON.stringify({ action, confidence, reasoning: 'test' }),
      },
    }],
  })
}

/** Make the OpenAI mock return a personality passthrough */
function mockPersonality(text?: string) {
  mockOpenAICreate.mockResolvedValueOnce({
    choices: [{ message: { content: text || 'yo' } }],
  })
}

/** A brand-new user object (no name, needs onboarding) */
const NEW_USER = {
  id: 'user-1',
  phone: '1234567890',
  name: null,
  needs_name: true,
  opted_out: false,
  pending_poll: null,
  last_response: null,
  last_notes: null,
}

/** An onboarded user */
const EXISTING_USER = {
  ...NEW_USER,
  name: 'Sarah',
  needs_name: false,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Onboarding Flow', () => {
  beforeEach(() => {
    // Reset all mocks completely (clears queued mockResolvedValueOnce too)
    mockOpenAICreate.mockReset()
    mockGetMember.mockReset()
    mockCreateMember.mockReset()
    mockUpdateMemberName.mockReset()
    mockIsAdmin.mockReset()
    mockLogMessage.mockReset()
    mockGetRecentMessages.mockReset()
    mockGetActiveSpaceId.mockReset()
    mockGetSpaceMember.mockReset()
    mockGetUserSpacesByPhone.mockReset()
    mockIsSpaceAdminByPhone.mockReset()
    mockFindSpaceByJoinCode.mockReset()
    mockAddUserToSpace.mockReset()
    mockSetActiveSpaceId.mockReset()
    mockSetMemberOptedOut.mockReset()
    mockPrismaUpdateMany.mockReset()

    // Re-register OpenAI constructor
    mockOpenAIConstructor.mockImplementation(() => ({
      chat: { completions: { create: mockOpenAICreate } },
    }))
    // Re-register defaults
    mockLogMessage.mockResolvedValue({
      id: 'msg-1', phoneNumber: '1234567890', direction: 'outbound',
      text: '', meta: null, createdAt: new Date(),
    })
    mockGetRecentMessages.mockResolvedValue([])
    // Default: no active space, legacy mode
    mockGetActiveSpaceId.mockResolvedValue(null)
    mockGetSpaceMember.mockResolvedValue(null)
    mockGetUserSpacesByPhone.mockResolvedValue([])
    mockIsAdmin.mockReturnValue(false)
    mockIsSpaceAdminByPhone.mockResolvedValue(false)
  })

  // =========================================================================
  // Stage 1: Brand-new user — first contact
  // =========================================================================
  describe('Stage 1: Brand-new user (no account exists)', () => {
    it('creates a new member when phone is unknown', async () => {
      mockGetMember.mockResolvedValueOnce(null)
      mockCreateMember.mockResolvedValueOnce(NEW_USER)
      // "hello" is quick-rejected by extractName (greeting regex), no LLM call needed

      const text = await getResponseText(makeSmsRequest('hello'))

      expect(mockCreateMember).toHaveBeenCalledWith('1234567890')
      // Should ask for name on first contact
      expect(text).toMatch(/jarvis/i)
      expect(text).toMatch(/name/i)
    })

    it('returns JOIN prompt when member creation fails and no spaces exist', async () => {
      mockGetMember.mockResolvedValueOnce(null)
      mockCreateMember.mockResolvedValueOnce(null)
      mockGetUserSpacesByPhone.mockResolvedValueOnce([])

      const text = await getResponseText(makeSmsRequest('hey'))

      expect(text).toMatch(/JOIN/i)
      expect(text).toMatch(/code/i)
    })

    it('returns error when member creation fails but spaces exist', async () => {
      mockGetMember.mockResolvedValueOnce(null)
      mockCreateMember.mockResolvedValueOnce(null)
      mockGetUserSpacesByPhone.mockResolvedValueOnce([{ id: 's1', name: 'Test Space' }])

      const text = await getResponseText(makeSmsRequest('hey'))

      expect(text).toMatch(/couldn't create/i)
    })
  })

  // =========================================================================
  // Stage 2: Name extraction
  // =========================================================================
  describe('Stage 2: Name extraction from messages', () => {
    beforeEach(() => {
      mockGetMember.mockResolvedValueOnce(NEW_USER)
    })

    it('extracts a simple first name', async () => {
      mockNameExtraction('Sarah')
      mockUpdateMemberName.mockResolvedValueOnce(true)

      const text = await getResponseText(makeSmsRequest('Sarah'))

      expect(mockUpdateMemberName).toHaveBeenCalledWith('user-1', 'Sarah')
      expect(text).toMatch(/sarah/i)
      expect(text).toMatch(/set/i)
    })

    it('extracts name from "I\'m John"', async () => {
      mockNameExtraction('John')
      mockUpdateMemberName.mockResolvedValueOnce(true)

      const text = await getResponseText(makeSmsRequest("I'm John"))

      expect(mockUpdateMemberName).toHaveBeenCalledWith('user-1', 'John')
      expect(text).toMatch(/john/i)
    })

    it('extracts name from "my name is Maria Garcia"', async () => {
      mockNameExtraction('Maria Garcia')
      mockUpdateMemberName.mockResolvedValueOnce(true)

      const text = await getResponseText(makeSmsRequest('my name is Maria Garcia'))

      expect(mockUpdateMemberName).toHaveBeenCalledWith('user-1', 'Maria Garcia')
      expect(text).toMatch(/maria/i)
    })

    it('extracts name from "call me Mike"', async () => {
      mockNameExtraction('Mike')
      mockUpdateMemberName.mockResolvedValueOnce(true)

      const text = await getResponseText(makeSmsRequest('call me Mike'))

      expect(mockUpdateMemberName).toHaveBeenCalledWith('user-1', 'Mike')
    })

    it('does NOT extract name from greeting "hey"', async () => {
      // "hey" hits the quick-reject before LLM is called
      const text = await getResponseText(makeSmsRequest('hey'))

      expect(mockUpdateMemberName).not.toHaveBeenCalled()
      expect(text).toMatch(/name/i)
    })

    it('does NOT extract name from "yes"', async () => {
      // "yes" hits the quick-reject regex
      const text = await getResponseText(makeSmsRequest('yes'))

      expect(mockUpdateMemberName).not.toHaveBeenCalled()
    })

    it('does NOT extract name from a question', async () => {
      mockNameExtraction(null) // LLM returns NOT_A_NAME

      const text = await getResponseText(makeSmsRequest('when is the meeting?'))

      expect(mockUpdateMemberName).not.toHaveBeenCalled()
      expect(text).toMatch(/name/i)
    })

    it('does NOT extract name from a very long message', async () => {
      const longMessage = 'a'.repeat(101)

      const text = await getResponseText(makeSmsRequest(longMessage))

      // extractName returns null for messages > 100 chars
      expect(mockUpdateMemberName).not.toHaveBeenCalled()
    })

    it('does NOT extract name from a 1-char message', async () => {
      const text = await getResponseText(makeSmsRequest('a'))

      // extractName returns null for messages < 2 chars
      expect(mockUpdateMemberName).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // Stage 3: Welcome messages
  // =========================================================================
  describe('Stage 3: Welcome messages after name collection', () => {
    it('shows admin welcome with capabilities for admin user', async () => {
      mockGetMember.mockResolvedValueOnce(NEW_USER)
      mockUpdateMemberName.mockResolvedValueOnce(true)
      mockIsAdmin.mockReturnValueOnce(true)
      mockNameExtraction('Admin Alex')

      const text = await getResponseText(makeSmsRequest('Admin Alex'))

      expect(text).toMatch(/admin/i)
      expect(text).toMatch(/announce/i)
    })

    it('shows regular welcome for non-admin user', async () => {
      mockGetMember.mockResolvedValueOnce(NEW_USER)
      mockUpdateMemberName.mockResolvedValueOnce(true)
      mockIsAdmin.mockReturnValueOnce(false)
      mockNameExtraction('Regular User')

      const text = await getResponseText(makeSmsRequest('Regular User'))

      expect(text).toMatch(/Regular User/i)
      expect(text).toMatch(/set/i)
      expect(text).not.toMatch(/admin/i)
    })

    it('first-ever message shows iron man intro', async () => {
      const firstTimeUser = { ...NEW_USER, name: null, needs_name: true }
      mockGetMember.mockResolvedValueOnce(firstTimeUser)
      // "hello" triggers greeting quick-reject, so extractName is never called

      const text = await getResponseText(makeSmsRequest('hello'))

      expect(text).toMatch(/jarvis/i)
      expect(text).toMatch(/iron man/i)
      expect(text).toMatch(/name/i)
    })

    it('subsequent ask-for-name prompt is shorter (no iron man intro)', async () => {
      // User already got first message but gave something that wasn't a name
      // The distinction is: first message = (!user.name && user.needs_name)
      // Subsequent = user had a name set but needs_name is still true
      const returningNoName = { ...NEW_USER, name: 'partial', needs_name: true }
      mockGetMember.mockResolvedValueOnce(returningNoName)
      mockNameExtraction(null)

      const text = await getResponseText(makeSmsRequest('what is this'))

      // Should still ask for name
      expect(text).toMatch(/name/i)
      // But should NOT have iron man intro (that's only for isFirstMessage)
      expect(text).not.toMatch(/iron man/i)
    })
  })

  // =========================================================================
  // Stage 4: System commands
  // =========================================================================
  describe('Stage 4: System commands (STOP, START, HELP)', () => {
    it('STOP unsubscribes the user', async () => {
      mockGetMember.mockResolvedValueOnce(EXISTING_USER)

      const text = await getResponseText(makeSmsRequest('STOP'))

      expect(text).toMatch(/unsubscribed/i)
    })

    it('START resubscribes the user', async () => {
      mockGetMember.mockResolvedValueOnce(EXISTING_USER)

      const text = await getResponseText(makeSmsRequest('START'))

      expect(text).toMatch(/welcome back/i)
    })

    it('HELP shows admin commands for admins', async () => {
      mockGetMember.mockResolvedValueOnce(EXISTING_USER)
      mockIsAdmin.mockReturnValueOnce(true)

      const text = await getResponseText(makeSmsRequest('HELP'))

      expect(text).toMatch(/admin/i)
      expect(text).toMatch(/announce/i)
    })

    it('HELP shows user commands for non-admins', async () => {
      mockGetMember.mockResolvedValueOnce(EXISTING_USER)
      mockIsAdmin.mockReturnValueOnce(false)

      const text = await getResponseText(makeSmsRequest('HELP'))

      expect(text).toMatch(/questions/i)
      expect(text).not.toMatch(/admin command/i)
    })

    it('system commands work even during onboarding (needs_name)', async () => {
      mockGetMember.mockResolvedValueOnce(NEW_USER)

      const text = await getResponseText(makeSmsRequest('STOP'))

      // STOP is handled before onboarding check
      expect(text).toMatch(/unsubscribed/i)
    })

    it('system commands are case-insensitive', async () => {
      mockGetMember.mockResolvedValueOnce(EXISTING_USER)

      const text = await getResponseText(makeSmsRequest('stop'))

      expect(text).toMatch(/unsubscribed/i)
    })
  })

  // =========================================================================
  // Stage 5: Space JOIN flow
  // =========================================================================
  describe('Stage 5: Space JOIN flow', () => {
    it('JOIN with valid code adds user to space', async () => {
      mockFindSpaceByJoinCode.mockResolvedValueOnce({
        id: 'space-1',
        name: 'Alpha Epsilon',
        joinCode: 'AE2024',
      })
      mockAddUserToSpace.mockResolvedValueOnce({ existing: false })
      mockSetActiveSpaceId.mockResolvedValueOnce(undefined)

      const text = await getResponseText(makeSmsRequest('JOIN AE2024'))

      expect(mockFindSpaceByJoinCode).toHaveBeenCalledWith('AE2024')
      expect(mockAddUserToSpace).toHaveBeenCalledWith('1234567890', 'space-1')
      expect(text).toMatch(/welcome/i)
      expect(text).toMatch(/Alpha Epsilon/i)
    })

    it('JOIN with invalid code returns error', async () => {
      mockFindSpaceByJoinCode.mockResolvedValueOnce(null)

      const text = await getResponseText(makeSmsRequest('JOIN BADCODE'))

      expect(text).toMatch(/not found/i)
    })

    it('JOIN to existing space switches to it', async () => {
      mockFindSpaceByJoinCode.mockResolvedValueOnce({
        id: 'space-1',
        name: 'Alpha Epsilon',
        joinCode: 'AE2024',
      })
      mockAddUserToSpace.mockResolvedValueOnce({ existing: true })

      const text = await getResponseText(makeSmsRequest('JOIN AE2024'))

      expect(text).toMatch(/switched/i)
      expect(text).toMatch(/Alpha Epsilon/i)
    })

    it('JOIN is case-insensitive', async () => {
      mockFindSpaceByJoinCode.mockResolvedValueOnce({
        id: 'space-1',
        name: 'Test Space',
        joinCode: 'TEST',
      })
      mockAddUserToSpace.mockResolvedValueOnce({ existing: false })

      await getResponseText(makeSmsRequest('join test'))

      // Code is uppercased before lookup
      expect(mockFindSpaceByJoinCode).toHaveBeenCalledWith('TEST')
    })

    it('SPACES command lists user spaces', async () => {
      mockGetUserSpacesByPhone.mockResolvedValueOnce([
        { id: 'space-1', name: 'Alpha Epsilon', joinCode: 'AE2024' },
        { id: 'space-2', name: 'Beta Theta', joinCode: 'BT2024' },
      ])
      mockGetActiveSpaceId.mockResolvedValueOnce('space-1')

      const text = await getResponseText(makeSmsRequest('SPACES'))

      expect(text).toMatch(/Alpha Epsilon/i)
      expect(text).toMatch(/Beta Theta/i)
      expect(text).toMatch(/active/i)
    })

    it('SPACES with no spaces tells user to JOIN', async () => {
      mockGetUserSpacesByPhone.mockResolvedValueOnce([])

      const text = await getResponseText(makeSmsRequest('SPACES'))

      expect(text).toMatch(/not in any/i)
      expect(text).toMatch(/JOIN/i)
    })
  })

  // =========================================================================
  // Stage 6: Post-onboarding — normal conversation
  // =========================================================================
  describe('Stage 6: Post-onboarding transition', () => {
    it('onboarded user goes straight to intent classification', async () => {
      mockGetMember.mockResolvedValueOnce(EXISTING_USER)
      // Classification → chat, personality pass
      mockClassification('chat')
      mockPersonality('sup sarah')

      const text = await getResponseText(makeSmsRequest('hey'))

      // Should NOT ask for name
      expect(text).not.toMatch(/what.*name/i)
    })

    it('content query works after onboarding', async () => {
      mockGetMember.mockResolvedValueOnce(EXISTING_USER)
      mockClassification('content_query')
      // The content query handler will search and may call OpenAI multiple times
      // Mock category detection
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({ categories: ['upcoming'], reasoning: 'test' }),
          },
        }],
      })
      // Mock personality
      mockPersonality('no events rn')

      const text = await getResponseText(makeSmsRequest('when is the next meeting'))

      expect(mockOpenAICreate).toHaveBeenCalled()
    })
  })

  // =========================================================================
  // Stage 7: Space-scoped onboarding
  // =========================================================================
  describe('Stage 7: Space-scoped onboarding', () => {
    it('onboards user within a space (no Airtable call)', async () => {
      mockGetActiveSpaceId.mockResolvedValueOnce('space-1')
      mockGetSpaceMember.mockResolvedValueOnce({
        userId: 'user-1',
        phoneNumber: '1234567890',
        name: null,
        optedOut: false,
      })
      mockNameExtraction('Priya')

      const text = await getResponseText(makeSmsRequest('Priya'))

      // Should NOT call Airtable updateMemberName (space members use Prisma)
      expect(mockUpdateMemberName).not.toHaveBeenCalled()
      expect(text).toMatch(/priya/i)
    })

    it('space admin gets admin welcome', async () => {
      mockGetActiveSpaceId.mockResolvedValueOnce('space-1')
      mockGetSpaceMember.mockResolvedValueOnce({
        userId: 'user-1',
        phoneNumber: '1234567890',
        name: null,
        optedOut: false,
      })
      mockIsSpaceAdminByPhone.mockResolvedValueOnce(true)
      mockNameExtraction('Admin')
      mockPrismaUpdateMany.mockResolvedValueOnce({ count: 1 })

      const text = await getResponseText(makeSmsRequest('Admin'))

      expect(text).toMatch(/admin/i)
    })

    it('STOP in a space opts out at space level', async () => {
      mockGetActiveSpaceId.mockResolvedValueOnce('space-1')
      mockGetSpaceMember.mockResolvedValueOnce({
        userId: 'user-1',
        phoneNumber: '1234567890',
        name: 'Sarah',
        optedOut: false,
      })

      const text = await getResponseText(makeSmsRequest('STOP'))

      expect(mockSetMemberOptedOut).toHaveBeenCalledWith('space-1', expect.any(String), true)
      expect(text).toMatch(/unsubscribed/i)
    })
  })

  // =========================================================================
  // Stage 8: Edge cases
  // =========================================================================
  describe('Stage 8: Edge cases', () => {
    it('empty message body is handled gracefully', async () => {
      mockGetMember.mockResolvedValueOnce(NEW_USER)
      mockNameExtraction(null)

      const text = await getResponseText(makeSmsRequest(''))

      // Should still respond (ask for name or something)
      expect(text).toBeTruthy()
    })

    it('whitespace-only message is handled', async () => {
      mockGetMember.mockResolvedValueOnce(NEW_USER)
      mockNameExtraction(null)

      const text = await getResponseText(makeSmsRequest('   '))

      expect(text).toBeTruthy()
    })

    it('message with only emojis during onboarding', async () => {
      mockGetMember.mockResolvedValueOnce(NEW_USER)
      mockNameExtraction(null) // Emojis are not a name

      const text = await getResponseText(makeSmsRequest('😂🔥'))

      expect(mockUpdateMemberName).not.toHaveBeenCalled()
    })

    it('numeric-only message is not treated as a name', async () => {
      mockGetMember.mockResolvedValueOnce(NEW_USER)
      // "12345" is not explicitly rejected by quick checks, goes to LLM
      mockNameExtraction(null)

      const text = await getResponseText(makeSmsRequest('12345'))

      expect(mockUpdateMemberName).not.toHaveBeenCalled()
    })

    it('message logs are created for both inbound and outbound', async () => {
      mockGetMember.mockResolvedValueOnce(EXISTING_USER)
      mockClassification('chat')
      mockPersonality('yo')

      await getResponseText(makeSmsRequest('whats good'))

      // Inbound log
      expect(mockLogMessage).toHaveBeenCalledWith(
        '1234567890',
        'inbound',
        'whats good',
        null,
        null // no space
      )
      // Outbound log
      expect(mockLogMessage).toHaveBeenCalledWith(
        '1234567890',
        'outbound',
        expect.any(String),
        expect.objectContaining({ action: 'chat' }),
        null
      )
    })
  })
})
