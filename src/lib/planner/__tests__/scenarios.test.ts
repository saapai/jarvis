/**
 * Real-World Scenario Tests
 * Tests based on actual conversation patterns and edge cases
 */

import { plan, PlannerInput } from '../index'
import { UserContext } from '../types'
import { clearHistory, clearDraft } from '../history'

// ============================================
// TEST HELPERS
// ============================================

const adminUser: UserContext = {
  phone: '1111111111',
  name: 'Armaan',
  isAdmin: true,
  needsName: false,
  optedOut: false
}

const regularUser: UserContext = {
  phone: '2222222222',
  name: 'Quinn',
  isAdmin: false,
  needsName: false,
  optedOut: false
}

async function testMessage(
  user: UserContext,
  message: string,
  prevHistory?: string
): Promise<{ response: string; action: string; classification: any }> {
  clearHistory(user.phone)
  clearDraft(user.phone)
  
  const result = await plan({
    phone: user.phone,
    message,
    user,
    conversationHistoryJson: prevHistory || null,
    sendAnnouncement: async () => 15,
    sendPoll: async () => 15
  })
  
  return {
    response: result.response,
    action: result.action,
    classification: result.classification
  }
}

// ============================================
// SCENARIO: Natural Language Announcements
// ============================================

describe('Scenario: Natural Language Announcements', () => {
  const announcementTestCases = [
    'announce meeting tonight at 7pm',
    'tell everyone about the party',
    'let everyone know dinner is at 8',
    'send out a message about the retreat',
    'notify everyone that we are meeting at bcaf',
  ]
  
  test.each(announcementTestCases)('"%s" → announcement draft', async (input) => {
    const result = await testMessage(adminUser, input)
    expect(result.action).toBe('draft_write')
    expect(result.classification.subtype).toBe('announcement')
  })
})

// ============================================
// SCENARIO: Natural Language Polls
// ============================================

describe('Scenario: Natural Language Polls', () => {
  const pollTestCases = [
    'poll who is coming tonight',
    "who's coming to active",
    'ask everyone if they can make it',
    'who is free for dinner tomorrow',
    'create a poll about the retreat date',
    'who can attend the meeting',
  ]
  
  test.each(pollTestCases)('"%s" → poll draft', async (input) => {
    const result = await testMessage(adminUser, input)
    expect(result.action).toBe('draft_write')
    expect(result.classification.subtype).toBe('poll')
  })
})

// ============================================
// SCENARIO: Content Queries
// ============================================

describe('Scenario: Content Queries', () => {
  const contentQueryCases = [
    'when is active meeting',
    'what time is the meeting tonight',
    'where is dinner',
    "what's happening this weekend",
    'is there an event tomorrow',
    'tell me about the retreat',
    'what are we doing tonight',
    'when does active start',
    'what time should I be there',
    'where should we meet',
  ]
  
  test.each(contentQueryCases)('"%s" → content_query', async (input) => {
    const result = await testMessage(regularUser, input)
    expect(result.action).toBe('content_query')
  })
})

// ============================================
// SCENARIO: Capability Queries
// ============================================

describe('Scenario: Capability Queries', () => {
  const capabilityQueryCases = [
    'what can you do',
    'help',
    'who are you',
    'are you a bot',
    'what is jarvis',
    'what is enclave',
    'how do you work',
    'commands',
  ]
  
  test.each(capabilityQueryCases)('"%s" → capability_query', async (input) => {
    const result = await testMessage(regularUser, input)
    expect(result.action).toBe('capability_query')
  })
})

// ============================================
// SCENARIO: Send Commands
// ============================================

describe('Scenario: Send Commands', () => {
  const sendVariations = [
    'send',
    'send it',
    'go',
    'ship it',
    'ship',
    'yes',
    'yep',
    'do it',
  ]
  
  test.each(sendVariations)('"%s" with draft → draft_send', async (input) => {
    // First create a draft
    await testMessage(adminUser, 'announce meeting at 7')
    
    // Then try to send
    const result = await plan({
      phone: adminUser.phone,
      message: input,
      user: adminUser,
      sendAnnouncement: async () => 15,
      sendPoll: async () => 15
    })
    
    expect(result.action).toBe('draft_send')
  })
})

// ============================================
// SCENARIO: Greetings and Chat
// ============================================

describe('Scenario: Greetings and Chat', () => {
  const greetings = ['hi', 'hey', 'hello', 'yo', 'sup']
  
  test.each(greetings)('"%s" → chat with greeting response', async (input) => {
    const result = await testMessage(regularUser, input)
    expect(result.action).toBe('chat')
    expect(result.response.toLowerCase()).toMatch(/hey|sup|yo|hi|hello|what/)
  })
  
  const thankYous = ['thanks', 'thank you', 'thx', 'ty']
  
  test.each(thankYous)('"%s" → chat with acknowledgment', async (input) => {
    const result = await testMessage(regularUser, input)
    expect(result.action).toBe('chat')
    // More lenient matching
    expect(result.response.length).toBeGreaterThan(0)
  })
  
  const goodbyes = ['bye', 'goodbye', 'later', 'peace']
  
  test.each(goodbyes)('"%s" → chat with goodbye', async (input) => {
    const result = await testMessage(regularUser, input)
    expect(result.action).toBe('chat')
    expect(result.response.toLowerCase()).toMatch(/bye|later|peace|ttyl|night/)
  })
})

// ============================================
// SCENARIO: Insults and Roasts
// ============================================

describe('Scenario: Insults and Roasts', () => {
  const insults = [
    'you suck',
    'this is stupid',
    'you are useless',
    'worst bot ever',
    "you're trash",
  ]
  
  test.each(insults)('"%s" → chat with comeback', async (input) => {
    const result = await testMessage(regularUser, input)
    expect(result.action).toBe('chat')
    // Response should exist and not be empty
    expect(result.response.length).toBeGreaterThan(5)
    // Should not be a typical help response
    expect(result.response.toLowerCase()).not.toMatch(/^how can i (help|assist)/)
  })
})

// ============================================
// SCENARIO: Quick Responses
// ============================================

describe('Scenario: Quick Responses', () => {
  const quickInputs = [
    { input: 'ok', expectShort: true },
    { input: 'lol', expectShort: true },
    { input: 'bruh', expectShort: true },
    { input: 'nice', expectShort: true },
    { input: 'cool', expectShort: true },
    { input: 'fr', expectShort: true },
    { input: 'bet', expectShort: true },
    { input: '?', expectShort: true },
  ]
  
  test.each(quickInputs)('$input → quick response', async ({ input, expectShort }) => {
    const result = await testMessage(regularUser, input)
    expect(result.action).toBe('chat')
    if (expectShort) {
      expect(result.response.length).toBeLessThan(100)
    }
  })
})

// ============================================
// SCENARIO: Cancel Commands
// ============================================

describe('Scenario: Cancel Commands', () => {
  const cancelVariations = [
    'cancel',
    'nvm',
    'nevermind',
    'never mind',
    'delete',
    'discard',
    'forget it',
  ]
  
  test.each(cancelVariations)('"%s" with draft → clears draft', async (input) => {
    // First create a draft
    await testMessage(adminUser, 'announce meeting at 7')
    
    // Then cancel
    const result = await plan({
      phone: adminUser.phone,
      message: input,
      user: adminUser,
      sendAnnouncement: async () => 15,
      sendPoll: async () => 15
    })
    
    expect(result.action).toBe('chat')
    expect(result.response.toLowerCase()).toMatch(/cancel|scrap|discard|forget|nothing/)
  })
})

// ============================================
// SCENARIO: Edit Commands
// ============================================

describe('Scenario: Edit Commands', () => {
  const editCases = [
    { edit: 'no it should say meeting at 8', expectContent: '8' },
    { edit: 'make it say dinner instead', expectContent: 'dinner' },
    { edit: 'change it to 9pm', expectContent: '9pm' },
  ]
  
  test.each(editCases)('edit: "$edit"', async ({ edit, expectContent }) => {
    // First create a draft
    await testMessage(adminUser, 'announce meeting at 7')
    
    // Then edit
    const result = await plan({
      phone: adminUser.phone,
      message: edit,
      user: adminUser,
      sendAnnouncement: async () => 15,
      sendPoll: async () => 15
    })
    
    expect(result.action).toBe('draft_write')
    if (expectContent) {
      expect(result.response.toLowerCase()).toContain(expectContent.toLowerCase())
    }
  })
})

// ============================================
// SCENARIO: Non-Admin Restrictions
// ============================================

describe('Scenario: Non-Admin Restrictions', () => {
  const adminCommands = [
    'announce meeting tonight',
    'poll who is coming',
    'make an announcement',
    'create a poll',
    'tell everyone about dinner',
  ]
  
  test.each(adminCommands)('non-admin: "%s" → handled appropriately', async (input) => {
    const result = await testMessage(regularUser, input)
    // Should be rejected or handled differently than admin
    // Either not draft_write, or if it is, should indicate not allowed
    if (result.action === 'draft_write') {
      expect(result.response.toLowerCase()).toMatch(/admin|can't|cannot|not allowed|permission/)
    }
  })
})

// ============================================
// SCENARIO: Ambiguous Messages
// ============================================

describe('Scenario: Ambiguous Messages', () => {
  test('"yes" without context → chat', async () => {
    const result = await testMessage(regularUser, 'yes')
    expect(result.action).toBe('chat')
  })
  
  test('"go" without draft → not draft_send', async () => {
    const result = await testMessage(adminUser, 'go')
    expect(result.action).not.toBe('draft_send')
  })
  
  test('"meeting tonight" alone → chat (not announcement)', async () => {
    const result = await testMessage(adminUser, 'meeting tonight')
    // Without explicit command, this should be chat
    expect(result.action).toBe('chat')
  })
})

// ============================================
// SCENARIO: Edge Cases
// ============================================

describe('Scenario: Edge Cases', () => {
  test('empty message', async () => {
    const result = await testMessage(regularUser, '')
    expect(result.action).toBe('chat')
    expect(result.response).toBeTruthy()
  })
  
  test('very long message', async () => {
    const longMessage = 'a'.repeat(500)
    const result = await testMessage(regularUser, longMessage)
    expect(result.action).toBe('chat')
  })
  
  test('only emoji', async () => {
    const result = await testMessage(regularUser, '👍👍👍')
    expect(result.action).toBe('chat')
  })
  
  test('only punctuation', async () => {
    const result = await testMessage(regularUser, '...')
    expect(result.action).toBe('chat')
  })
  
  test('mixed case command', async () => {
    const result = await testMessage(adminUser, 'ANNOUNCE meeting tonight')
    expect(result.action).toBe('draft_write')
  })
  
  test('extra whitespace', async () => {
    const result = await testMessage(adminUser, '  announce   meeting  tonight  ')
    expect(result.action).toBe('draft_write')
  })
  
  test('numbers only', async () => {
    const result = await testMessage(regularUser, '12345')
    expect(result.action).toBe('chat')
  })
  
  test('special characters', async () => {
    const result = await testMessage(regularUser, '@#$%^&*()')
    expect(result.action).toBe('chat')
  })
})

// ============================================
// SCENARIO: Easter Eggs
// ============================================

describe('Scenario: Easter Eggs', () => {
  test('meaning of life', async () => {
    const result = await testMessage(regularUser, 'what is the meaning of life')
    expect(result.response).toContain('42')
  })
  
  test('tell me a joke', async () => {
    const result = await testMessage(regularUser, 'tell me a joke')
    expect(result.response.length).toBeGreaterThan(20)
  })
  
  test('good morning', async () => {
    const result = await testMessage(regularUser, 'good morning')
    expect(result.response.toLowerCase()).toMatch(/morn/)
  })
  
  test('how are you', async () => {
    const result = await testMessage(regularUser, 'how are you')
    expect(result.response.length).toBeGreaterThan(5)
  })
})

// ============================================
// SCENARIO: Complex Multi-Step Flows
// ============================================

describe('Scenario: Complex Flows', () => {
  test('Create → Edit → Send announcement', async () => {
    // Step 1: Create
    clearHistory(adminUser.phone)
    clearDraft(adminUser.phone)
    
    let result = await plan({
      phone: adminUser.phone,
      message: 'announce meeting at 7',
      user: adminUser,
      sendAnnouncement: async () => 15,
      sendPoll: async () => 15
    })
    expect(result.action).toBe('draft_write')
    
    // Step 2: Edit
    result = await plan({
      phone: adminUser.phone,
      message: 'change it to 8pm',
      user: adminUser,
      sendAnnouncement: async () => 15,
      sendPoll: async () => 15
    })
    expect(result.action).toBe('draft_write')
    expect(result.response).toContain('8pm')
    
    // Step 3: Send
    result = await plan({
      phone: adminUser.phone,
      message: 'send',
      user: adminUser,
      sendAnnouncement: async () => 15,
      sendPoll: async () => 15
    })
    expect(result.action).toBe('draft_send')
  })
  
  test('Start announcement → Cancel → Start poll → Send', async () => {
    clearHistory(adminUser.phone)
    clearDraft(adminUser.phone)
    
    // Start announcement
    let result = await plan({
      phone: adminUser.phone,
      message: 'announce dinner at 7',
      user: adminUser,
      sendAnnouncement: async () => 15,
      sendPoll: async () => 15
    })
    expect(result.action).toBe('draft_write')
    
    // Cancel
    result = await plan({
      phone: adminUser.phone,
      message: 'cancel',
      user: adminUser,
      sendAnnouncement: async () => 15,
      sendPoll: async () => 15
    })
    expect(result.action).toBe('chat')
    
    // Start poll
    result = await plan({
      phone: adminUser.phone,
      message: 'poll who is coming',
      user: adminUser,
      sendAnnouncement: async () => 15,
      sendPoll: async () => 15
    })
    expect(result.action).toBe('draft_write')
    expect(result.classification.subtype).toBe('poll')
    
    // Send poll
    result = await plan({
      phone: adminUser.phone,
      message: 'send',
      user: adminUser,
      sendAnnouncement: async () => 15,
      sendPoll: async () => 15
    })
    expect(result.action).toBe('draft_send')
  })
})

// ============================================
// SCENARIO: Response Quality
// ============================================

describe('Scenario: Response Quality', () => {
  test('All responses are non-empty strings', async () => {
    const testMessages = [
      'hi', 'help', 'when is the meeting', 'you suck', 
      'lol', '???', '', 'announce test'
    ]
    
    for (const msg of testMessages) {
      const result = await testMessage(
        msg === 'announce test' ? adminUser : regularUser, 
        msg
      )
      expect(typeof result.response).toBe('string')
      expect(result.response.length).toBeGreaterThan(0)
    }
  })
  
  test('No "undefined" or "null" in responses', async () => {
    const testMessages = ['hi', 'help', 'announce test', 'lol']
    
    for (const msg of testMessages) {
      const result = await testMessage(
        msg === 'announce test' ? adminUser : regularUser,
        msg
      )
      expect(result.response).not.toContain('undefined')
      expect(result.response).not.toContain('null')
    }
  })
})
