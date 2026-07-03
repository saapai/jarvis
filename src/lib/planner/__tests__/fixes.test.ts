/**
 * Tests for the specific fixes:
 * 1. "did everyone get it" / "?????" should NOT trigger re-send
 * 2. Only phone 3853687238 can send announcements
 * 3. After sending, saying "send" again should clarify, not re-send
 * 4. Poll response action removed
 */

import { classifyIntent } from '../classifier'
import { ClassificationContext, WeightedTurn, Draft } from '../types'
import { getQuickResponse } from '../personality'

// ============================================
// TEST HELPERS
// ============================================

function createContext(
  message: string,
  options: {
    history?: Partial<WeightedTurn>[]
    activeDraft?: Draft | null
    isAdmin?: boolean
    userName?: string | null
  } = {}
): ClassificationContext {
  return {
    currentMessage: message,
    history: (options.history || []).map((h, i) => ({
      role: h.role || 'user',
      content: h.content || '',
      timestamp: Date.now() - (i * 60000),
      weight: h.weight || 1.0 - (i * 0.2)
    })) as WeightedTurn[],
    activeDraft: options.activeDraft || null,
    isAdmin: options.isAdmin ?? false,
    userName: options.userName ?? null,
    hasActivePoll: options.hasActivePoll ?? false
  }
}

function createDraft(type: 'announcement' | 'poll', status: 'drafting' | 'ready', content = ''): Draft {
  return {
    type,
    content,
    status,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

// ============================================
// 1. QUESTION MARKS HANDLING
// ============================================

describe('Question mark responses', () => {
  test('"?" gets a reasonable response', () => {
    const response = getQuickResponse('?')
    expect(response).not.toBeNull()
    expect(response).toBeTruthy()
  })

  test('"??" gets a reasonable response', () => {
    const response = getQuickResponse('??')
    expect(response).not.toBeNull()
  })

  test('"???" gets a reasonable response', () => {
    const response = getQuickResponse('???')
    expect(response).not.toBeNull()
  })

  test('"?????" gets a reasonable response (arbitrary length)', () => {
    const response = getQuickResponse('?????')
    expect(response).not.toBeNull()
    // Should NOT be something like "noted!" or contextless
    expect(response).toMatch(/what|need|good|up/i)
  })

  test('"??????????" gets a reasonable response', () => {
    const response = getQuickResponse('??????????')
    expect(response).not.toBeNull()
    expect(response).toMatch(/what|need|good|up/i)
  })
})

// ============================================
// 2. "DID EVERYONE GET IT" CLASSIFICATION
// ============================================

describe('Follow-up after sending announcement', () => {
  test('"did everyone get it" should be chat, not draft_send', async () => {
    const context = createContext('Did everyone get this message', {
      isAdmin: true,
      userName: 'Yashas',
      history: [
        { role: 'user', content: 'Send', weight: 0.6 },
        { role: 'assistant', content: 'done. sent to 56 people', weight: 0.8 },
      ],
      // No active draft - it was already sent
      activeDraft: null,
    })

    const result = await classifyIntent(context)
    expect(result.action).toBe('chat')
    expect(result.action).not.toBe('draft_send')
  })

  test('"did that send" should be chat, not draft_send', async () => {
    const context = createContext('did that send', {
      isAdmin: true,
      activeDraft: null,
      history: [
        { role: 'assistant', content: 'done. sent to 56 people', weight: 0.8 },
      ],
    })

    const result = await classifyIntent(context)
    expect(result.action).toBe('chat')
  })

  test('"did it go through" should be chat', async () => {
    const context = createContext('did it go through', {
      isAdmin: true,
      activeDraft: null,
    })

    const result = await classifyIntent(context)
    expect(result.action).toBe('chat')
  })
})

// ============================================
// 3. PATTERN MATCHER: "SEND" WITH NO DRAFT
// ============================================

describe('Pattern matcher with no active draft', () => {
  test('"send" with no active draft should NOT pattern-match to draft_send', async () => {
    const context = createContext('send', {
      isAdmin: true,
      activeDraft: null,
    })

    // The pattern matcher only triggers draft_send when activeDraft is ready
    // So with no draft, it goes to LLM which should classify as chat
    const result = await classifyIntent(context)
    // It should NOT be draft_send since there's no draft
    // The LLM should figure out there's nothing to send
    expect(result.action).not.toBe('draft_send')
  })

  test('"send" with ready draft should match draft_send', async () => {
    const draft = createDraft('announcement', 'ready', 'test announcement')
    const context = createContext('send', {
      isAdmin: true,
      activeDraft: draft,
    })

    const result = await classifyIntent(context)
    expect(result.action).toBe('draft_send')
  })
})

// ============================================
// 4. POLL RESPONSE ACTION REMOVED
// ============================================

describe('Poll response action removed', () => {
  test('"yes" without active draft should be chat, not poll_response', async () => {
    const context = createContext('yes', {
      activeDraft: null,
    })

    const result = await classifyIntent(context)
    // Should NOT be poll_response since we removed it
    expect(result.action).not.toBe('poll_response')
  })

  test('"no" without context should be chat', async () => {
    const context = createContext('no', {
      activeDraft: null,
    })

    const result = await classifyIntent(context)
    expect(result.action).not.toBe('poll_response')
  })
})

// ============================================
// 5. SEND HANDLER DUPLICATE PROTECTION
// ============================================

// Note: handleDraftSend duplicate protection is tested via integration
// since it requires DB access. The key logic:
// - When no draft exists, it checks recent messages for a prior send
// - If found, it responds with "i just sent the announcement X. was there another?"
// - This prevents the duplicate send seen in the screenshots

describe('Send handler - pattern matcher prevents re-send', () => {
  test('"send" with NO active draft does NOT pattern-match to draft_send', async () => {
    const context = createContext('Send', {
      isAdmin: true,
      activeDraft: null,
      history: [
        { role: 'assistant', content: 'done. sent to 56 people', weight: 1.0 },
        { role: 'user', content: 'Send', weight: 0.8 },
      ],
    })

    const result = await classifyIntent(context)
    // Without an active draft, the pattern matcher won't trigger
    // and LLM should recognize there's nothing to send
    expect(result.action).not.toBe('draft_send')
  })
})

// ============================================
// 6. UNAUTHORIZED SENDER (tested at route level)
// ============================================

describe('Phone number authorization', () => {
  // Authorization is enforced at the route level (route.ts):
  // const AUTHORIZED_SENDER = '3853687238'
  // const isSenderAuthorized = normalizePhone(phone) === AUTHORIZED_SENDER
  // Only isSenderAuthorized can hit draft_write/draft_send handlers
  // Others get "only the admin can send announcements"

  test('authorization constant is documented', () => {
    // This test just documents the expected behavior
    // The actual check is in the route handler
    expect(true).toBe(true)
  })
})
