/**
 * Classifier Tests
 * Tests for intent classification with various conversation scenarios
 */

import { classifyIntent, looksLikeQuestion, looksLikeCommand, extractContent } from '../classifier'
import { ClassificationContext, WeightedTurn, Draft } from '../types'

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
    userName: options.userName ?? null
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
// ADMIN ANNOUNCEMENT TESTS
// ============================================

describe('Admin Announcement Classification', () => {
  test('explicit "announce X" command', async () => {
    const result = await classifyIntent(createContext(
      'announce meeting tonight at 7pm',
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('announcement')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })
  
  test('"make an announcement" without content', async () => {
    const result = await classifyIntent(createContext(
      'make an announcement',
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('announcement')
  })
  
  test('"send an announcement" without content', async () => {
    const result = await classifyIntent(createContext(
      'send an announcement',
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('announcement')
  })
  
  test('"tell everyone about X"', async () => {
    const result = await classifyIntent(createContext(
      'tell everyone about the party tomorrow',
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('announcement')
  })
  
  test('"let everyone know X"', async () => {
    const result = await classifyIntent(createContext(
      'let everyone know meeting is cancelled',
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('announcement')
  })
  
  test('"send out a message to everyone"', async () => {
    const result = await classifyIntent(createContext(
      'send out a message to everyone about dinner',
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('announcement')
  })
  
  test('non-admin cannot make announcements', async () => {
    const result = await classifyIntent(createContext(
      'announce meeting tonight',
      { isAdmin: false }
    ))
    // Should not be classified as draft_write for non-admins
    expect(result.action).not.toBe('draft_write')
  })
})

// ============================================
// ADMIN POLL TESTS
// ============================================

describe('Admin Poll Classification', () => {
  test('explicit "poll X" command', async () => {
    const result = await classifyIntent(createContext(
      'poll who is coming tonight?',
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('poll')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })
  
  test('"make a poll" without content', async () => {
    const result = await classifyIntent(createContext(
      'make a poll',
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('poll')
  })
  
  test('"create a poll" without content', async () => {
    const result = await classifyIntent(createContext(
      'create a poll',
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('poll')
  })
  
  test('"ask everyone if X"', async () => {
    const result = await classifyIntent(createContext(
      'ask everyone if they can make it to active',
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('poll')
  })
  
  test('"who\'s coming to X"', async () => {
    const result = await classifyIntent(createContext(
      "who's coming to the meeting tonight",
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('poll')
  })
  
  test('"who is free for X"', async () => {
    const result = await classifyIntent(createContext(
      'who is free for dinner tomorrow',
      { isAdmin: true }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('poll')
  })
  
  test('non-admin cannot create polls', async () => {
    const result = await classifyIntent(createContext(
      'poll who is coming',
      { isAdmin: false }
    ))
    expect(result.action).not.toBe('draft_write')
  })
})

// ============================================
// SEND COMMAND TESTS
// ============================================

describe('Send Command Classification', () => {
  test('"send" with ready draft', async () => {
    const result = await classifyIntent(createContext(
      'send',
      { isAdmin: true, activeDraft: createDraft('announcement', 'ready', 'test message') }
    ))
    expect(result.action).toBe('draft_send')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })
  
  test('"send it" with ready draft', async () => {
    const result = await classifyIntent(createContext(
      'send it',
      { isAdmin: true, activeDraft: createDraft('poll', 'ready', 'test question?') }
    ))
    expect(result.action).toBe('draft_send')
  })
  
  test('"go" with ready draft', async () => {
    const result = await classifyIntent(createContext(
      'go',
      { isAdmin: true, activeDraft: createDraft('announcement', 'ready', 'test') }
    ))
    expect(result.action).toBe('draft_send')
  })
  
  test('"ship it" with ready draft', async () => {
    const result = await classifyIntent(createContext(
      'ship it',
      { isAdmin: true, activeDraft: createDraft('announcement', 'ready', 'test') }
    ))
    expect(result.action).toBe('draft_send')
  })
  
  test('"yes" with ready draft', async () => {
    const result = await classifyIntent(createContext(
      'yes',
      { isAdmin: true, activeDraft: createDraft('announcement', 'ready', 'test') }
    ))
    expect(result.action).toBe('draft_send')
  })
  
  test('"send" without draft should not be draft_send', async () => {
    const result = await classifyIntent(createContext(
      'send',
      { isAdmin: true, activeDraft: null }
    ))
    expect(result.action).not.toBe('draft_send')
  })
})

// ============================================
// CONTENT QUERY TESTS
// ============================================

describe('Content Query Classification', () => {
  test('"when is the meeting"', async () => {
    const result = await classifyIntent(createContext(
      'when is the meeting',
      { isAdmin: false }
    ))
    expect(result.action).toBe('content_query')
  })
  
  test('"what time is active"', async () => {
    const result = await classifyIntent(createContext(
      'what time is active',
      { isAdmin: false }
    ))
    expect(result.action).toBe('content_query')
  })
  
  test('"where is the event"', async () => {
    const result = await classifyIntent(createContext(
      'where is the event',
      { isAdmin: false }
    ))
    expect(result.action).toBe('content_query')
  })
  
  test('"what\'s happening tonight"', async () => {
    const result = await classifyIntent(createContext(
      "what's happening tonight",
      { isAdmin: false }
    ))
    expect(result.action).toBe('content_query')
  })
  
  test('"what is the plan for tomorrow"', async () => {
    const result = await classifyIntent(createContext(
      'what is the plan for tomorrow',
      { isAdmin: false }
    ))
    expect(result.action).toBe('content_query')
  })
  
  test('"is there a meeting today"', async () => {
    const result = await classifyIntent(createContext(
      'is there a meeting today',
      { isAdmin: false }
    ))
    expect(result.action).toBe('content_query')
  })
  
  test('"tell me about the retreat"', async () => {
    const result = await classifyIntent(createContext(
      'tell me about the retreat',
      { isAdmin: false }
    ))
    expect(result.action).toBe('content_query')
  })
})

// ============================================
// CAPABILITY QUERY TESTS
// ============================================

describe('Capability Query Classification', () => {
  test('"what can you do"', async () => {
    const result = await classifyIntent(createContext(
      'what can you do',
      { isAdmin: false }
    ))
    expect(result.action).toBe('capability_query')
  })
  
  test('"who are you"', async () => {
    const result = await classifyIntent(createContext(
      'who are you',
      { isAdmin: false }
    ))
    expect(result.action).toBe('capability_query')
  })
  
  test('"are you a bot"', async () => {
    const result = await classifyIntent(createContext(
      'are you a bot',
      { isAdmin: false }
    ))
    expect(result.action).toBe('capability_query')
  })
  
  test('"help"', async () => {
    const result = await classifyIntent(createContext(
      'help',
      { isAdmin: false }
    ))
    expect(result.action).toBe('capability_query')
  })
  
  test('"what is jarvis"', async () => {
    const result = await classifyIntent(createContext(
      'what is jarvis',
      { isAdmin: false }
    ))
    expect(result.action).toBe('capability_query')
  })
  
  test('"what is enclave"', async () => {
    const result = await classifyIntent(createContext(
      'what is enclave',
      { isAdmin: false }
    ))
    expect(result.action).toBe('capability_query')
  })
  
  test('"how do you work"', async () => {
    const result = await classifyIntent(createContext(
      'how do you work',
      { isAdmin: false }
    ))
    expect(result.action).toBe('capability_query')
  })
})

// ============================================
// CHAT/BANTER TESTS
// ============================================

describe('Chat Classification', () => {
  test('"hi" is chat', async () => {
    const result = await classifyIntent(createContext('hi', { isAdmin: false }))
    expect(result.action).toBe('chat')
  })
  
  test('"yo" is chat', async () => {
    const result = await classifyIntent(createContext('yo', { isAdmin: false }))
    expect(result.action).toBe('chat')
  })
  
  test('"thanks" is chat', async () => {
    const result = await classifyIntent(createContext('thanks', { isAdmin: false }))
    expect(result.action).toBe('chat')
  })
  
  test('"ok" is chat', async () => {
    const result = await classifyIntent(createContext('ok', { isAdmin: false }))
    expect(result.action).toBe('chat')
  })
  
  test('"lol" is chat', async () => {
    const result = await classifyIntent(createContext('lol', { isAdmin: false }))
    expect(result.action).toBe('chat')
  })
  
  test('insult is chat', async () => {
    const result = await classifyIntent(createContext('you suck', { isAdmin: false }))
    expect(result.action).toBe('chat')
  })
  
  test('random gibberish is chat', async () => {
    const result = await classifyIntent(createContext('asdfasdf', { isAdmin: false }))
    expect(result.action).toBe('chat')
  })
  
  test('"cancel" with draft is chat (will clear draft)', async () => {
    const result = await classifyIntent(createContext(
      'cancel',
      { isAdmin: true, activeDraft: createDraft('announcement', 'ready', 'test') }
    ))
    expect(result.action).toBe('chat')
  })
})

// ============================================
// CONTEXT-BASED CLASSIFICATION TESTS
// ============================================

describe('Context-Based Classification', () => {
  test('content after "what do you want to announce" is draft input', async () => {
    const result = await classifyIntent(createContext(
      'meeting tonight at 7',
      {
        isAdmin: true,
        activeDraft: createDraft('announcement', 'drafting'),
        history: [
          { role: 'assistant', content: 'what would you like to announce?', weight: 1.0 }
        ]
      }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('announcement')
  })
  
  test('content after "what is your poll question" is draft input', async () => {
    const result = await classifyIntent(createContext(
      'are you coming to active tonight',
      {
        isAdmin: true,
        activeDraft: createDraft('poll', 'drafting'),
        history: [
          { role: 'assistant', content: "what's your poll question?", weight: 1.0 }
        ]
      }
    ))
    expect(result.action).toBe('draft_write')
    expect(result.subtype).toBe('poll')
  })
  
  test('question after bot asked for content should NOT be draft input', async () => {
    const result = await classifyIntent(createContext(
      'when is the meeting?',  // This is a question, not draft content
      {
        isAdmin: true,
        activeDraft: createDraft('announcement', 'drafting'),
        history: [
          { role: 'assistant', content: 'what would you like to announce?', weight: 1.0 }
        ]
      }
    ))
    // Question should be detected and NOT treated as draft input
    expect(result.action).toBe('content_query')
  })
  
  test('edit instruction with ready draft', async () => {
    const result = await classifyIntent(createContext(
      'make it say meeting at 8pm instead',
      {
        isAdmin: true,
        activeDraft: createDraft('announcement', 'ready', 'meeting at 7pm')
      }
    ))
    expect(result.action).toBe('draft_write')
  })
  
  test('"no, it should say X" is draft edit', async () => {
    const result = await classifyIntent(createContext(
      'no it should say active meeting at 9',
      {
        isAdmin: true,
        activeDraft: createDraft('announcement', 'ready', 'meeting tonight')
      }
    ))
    expect(result.action).toBe('draft_write')
  })
})

// ============================================
// UTILITY FUNCTION TESTS
// ============================================

describe('Utility Functions', () => {
  test('looksLikeQuestion detects questions', () => {
    expect(looksLikeQuestion('when is the meeting?')).toBe(true)
    expect(looksLikeQuestion('what time is it')).toBe(true)
    expect(looksLikeQuestion('where is the party')).toBe(true)
    expect(looksLikeQuestion('how do I do this')).toBe(true)
    expect(looksLikeQuestion('is there a meeting')).toBe(true)
    expect(looksLikeQuestion('meeting tonight')).toBe(false)
    expect(looksLikeQuestion('send it')).toBe(false)
  })
  
  test('looksLikeCommand detects commands', () => {
    expect(looksLikeCommand('send it')).toBe(true)
    expect(looksLikeCommand('make an announcement')).toBe(true)
    expect(looksLikeCommand('create a poll')).toBe(true)
    expect(looksLikeCommand('cancel')).toBe(true)
    expect(looksLikeCommand('when is the meeting')).toBe(false)
    expect(looksLikeCommand('hi')).toBe(false)
  })
  
  test('extractContent removes command prefixes for announcements', () => {
    expect(extractContent('announce meeting tonight', 'announcement'))
      .toBe('meeting tonight')
    expect(extractContent('make an announcement about dinner', 'announcement'))
      .toBe('about dinner')
    expect(extractContent('tell everyone about the party', 'announcement'))
      .toBe('the party')
  })
  
  test('extractContent removes command prefixes for polls', () => {
    expect(extractContent('poll who is coming', 'poll'))
      .toBe('who is coming?')
    expect(extractContent('make a poll about dinner', 'poll'))
      .toBe('about dinner?')
    expect(extractContent('ask everyone if they can make it', 'poll'))
      .toBe('they can make it?')
  })
  
  test('extractContent adds question mark to polls', () => {
    expect(extractContent('are you coming tonight', 'poll'))
      .toBe('are you coming tonight?')
    expect(extractContent('coming tonight?', 'poll'))
      .toBe('coming tonight?')  // Already has ?
  })
})

