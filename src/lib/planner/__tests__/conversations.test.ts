/**
 * Conversation Flow Tests
 * End-to-end tests for multi-turn conversation scenarios
 */

import { plan, PlannerInput, PlannerResult } from '../index'
import { UserContext } from '../types'
import { clearHistory, clearDraft } from '../history'

// ============================================
// TEST HELPERS
// ============================================

function createAdminUser(name = 'Admin'): UserContext {
  return {
    phone: '1234567890',
    name,
    isAdmin: true,
    needsName: false,
    optedOut: false
  }
}

function createRegularUser(name = 'John'): UserContext {
  return {
    phone: '0987654321',
    name,
    isAdmin: false,
    needsName: false,
    optedOut: false
  }
}

async function simulateConversation(
  user: UserContext,
  messages: string[]
): Promise<PlannerResult[]> {
  const phone = user.phone
  clearHistory(phone)
  clearDraft(phone)
  
  const results: PlannerResult[] = []
  let historyJson: string | null = null
  
  for (const message of messages) {
    const input: PlannerInput = {
      phone,
      message,
      user,
      conversationHistoryJson: historyJson,
      // Mock functions for sending
      sendAnnouncement: async () => 10,
      sendPoll: async () => 10
    }
    
    const result = await plan(input)
    results.push(result)
    historyJson = result.newConversationHistoryJson
  }
  
  return results
}

// ============================================
// ANNOUNCEMENT FLOW TESTS
// ============================================

describe('Announcement Creation Flow', () => {
  test('Full flow: command → content → send', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'make an announcement',
      'meeting tonight at 7pm',
      'send it'
    ])
    
    // Step 1: Bot asks for content
    expect(results[0].action).toBe('draft_write')
    expect(results[0].response.toLowerCase()).toMatch(/announce|what/)
    
    // Step 2: Content is accepted, draft shown
    expect(results[1].action).toBe('draft_write')
    expect(results[1].response).toContain('meeting tonight at 7pm')
    expect(results[1].response.toLowerCase()).toContain('send')
    
    // Step 3: Draft is sent
    expect(results[2].action).toBe('draft_send')
    expect(results[2].response).toContain('10')  // Sent count
  })
  
  test('Direct announcement with content', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'announce meeting tonight at 7pm',
      'send'
    ])
    
    // Step 1: Draft created directly
    expect(results[0].action).toBe('draft_write')
    expect(results[0].response).toContain('meeting tonight at 7pm')
    
    // Step 2: Sent
    expect(results[1].action).toBe('draft_send')
  })
  
  test('Natural language announcement', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'tell everyone that dinner is at 8',
      'go'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[1].action).toBe('draft_send')
  })
  
  test('Edit announcement before sending', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'announce meeting at 7',
      'no it should say meeting at 8',
      'send it'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[1].action).toBe('draft_write')
    expect(results[1].response).toContain('8')  // Updated time
    expect(results[2].action).toBe('draft_send')
  })
  
  test('Cancel announcement', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'make an announcement',
      'cancel'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[1].action).toBe('chat')  // Cancel handled as chat
    expect(results[1].response.toLowerCase()).toMatch(/cancel|scrap|discard|forget/)
  })
})

// ============================================
// POLL FLOW TESTS
// ============================================

describe('Poll Creation Flow', () => {
  test('Full flow: command → question → send', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'make a poll',
      'are you coming to active tonight',
      'send'
    ])
    
    // Step 1: Bot asks for question
    expect(results[0].action).toBe('draft_write')
    
    // Step 2: Question accepted with ? added
    expect(results[1].action).toBe('draft_write')
    expect(results[1].response).toContain('?')
    
    // Step 3: Sent
    expect(results[2].action).toBe('draft_send')
  })
  
  test('Direct poll with content', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'poll who is coming tonight',
      'ship it'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[0].response).toContain('coming tonight')
    expect(results[1].action).toBe('draft_send')
  })
  
  test('Natural language poll - "who\'s coming"', async () => {
    const results = await simulateConversation(createAdminUser(), [
      "who's coming to the party",
      'yes'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[0].classification.subtype).toBe('poll')
    expect(results[1].action).toBe('draft_send')
  })
  
  test('Natural language poll - "ask everyone if"', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'ask everyone if they can make it to dinner',
      'go'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[0].classification.subtype).toBe('poll')
    expect(results[1].action).toBe('draft_send')
  })
})

// ============================================
// MIXED INTENT TESTS
// ============================================

describe('Mixed Intent Conversations', () => {
  test('Help during draft flow', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'make a poll',
      'help'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[1].action).toBe('capability_query')
  })
  
  test('Greeting then command', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'hey',
      'make an announcement',
      'party tonight',
      'send it'
    ])
    
    expect(results[0].action).toBe('chat')
    expect(results[1].action).toBe('draft_write')
    expect(results[2].action).toBe('draft_write')
    expect(results[3].action).toBe('draft_send')
  })
})

// ============================================
// REGULAR USER TESTS
// ============================================

describe('Regular User Conversations', () => {
  test('Regular user can create announcements', async () => {
    const results = await simulateConversation(createRegularUser(), [
      'announce meeting tonight'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[0].response.toLowerCase()).not.toMatch(/admin|cannot|not allowed|permission/)
  })
  
  test('Can ask questions', async () => {
    const results = await simulateConversation(createRegularUser(), [
      'when is the meeting'
    ])
    
    expect(results[0].action).toBe('content_query')
  })
  
  test('Can ask for help', async () => {
    const results = await simulateConversation(createRegularUser(), [
      'help'
    ])
    
    expect(results[0].action).toBe('capability_query')
  })
  
  test('Can have casual conversation', async () => {
    const results = await simulateConversation(createRegularUser(), [
      'hi',
      'thanks',
      'bye'
    ])
    
    expect(results[0].action).toBe('chat')
    expect(results[1].action).toBe('chat')
    expect(results[2].action).toBe('chat')
  })
})

// ============================================
// PERSONALITY TESTS
// ============================================

describe('Personality in Responses', () => {
  test('Responses have some content', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'make an announcement',
      'meeting at 7',
      'send it'
    ])
    
    // All responses should have content
    results.forEach(r => {
      expect(r.response.length).toBeGreaterThan(0)
    })
  })
  
  test('Handles insults with comebacks (not helpful responses)', async () => {
    const results = await simulateConversation(createRegularUser(), [
      'you suck'
    ])
    
    expect(results[0].action).toBe('chat')
    // Should be a comeback - check it's not a standard help message
    const response = results[0].response.toLowerCase()
    // Should not be a typical help response
    expect(response).not.toMatch(/^how can i (help|assist)/)
    expect(response.length).toBeGreaterThan(5)
  })
  
  test('Quick responses for short inputs', async () => {
    const results = await simulateConversation(createRegularUser(), [
      'lol',
      'ok',
      'k'
    ])
    
    // Should get quick, sassy responses
    results.forEach(r => {
      expect(r.action).toBe('chat')
      expect(r.response.length).toBeLessThan(100)
    })
  })
})

// ============================================
// EDGE CASES
// ============================================

describe('Edge Cases', () => {
  test('Empty message', async () => {
    const results = await simulateConversation(createRegularUser(), [
      ''
    ])
    
    expect(results[0].action).toBe('chat')
    expect(results[0].response).toBeTruthy()
  })
  
  test('Whitespace only message', async () => {
    const results = await simulateConversation(createRegularUser(), [
      '   '
    ])
    
    expect(results[0].action).toBe('chat')
  })
  
  test('Very long message', async () => {
    const longMessage = 'a'.repeat(1000)
    const results = await simulateConversation(createRegularUser(), [
      longMessage
    ])
    
    expect(results[0]).toBeTruthy()
    expect(results[0].action).toBe('chat')
  })
  
  test('Special characters', async () => {
    const results = await simulateConversation(createRegularUser(), [
      '???',
      '!!!'
    ])
    
    expect(results[0].action).toBe('chat')
    expect(results[1].action).toBe('chat')
  })
  
  test('Emoji only', async () => {
    const results = await simulateConversation(createRegularUser(), [
      '👍',
      '😂'
    ])
    
    expect(results[0].action).toBe('chat')
    expect(results[1].action).toBe('chat')
  })
})

// ============================================
// CONVERSATION CONTINUITY TESTS
// ============================================

describe('Conversation Continuity', () => {
  test('"send" after draft preview triggers send', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'announce meeting at 7',
      'send'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[1].action).toBe('draft_send')
  })
  
  test('"yes" after draft preview triggers send', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'announce meeting at 7',
      'yes'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[1].action).toBe('draft_send')
  })
  
  test('Multiple drafts - later draft replaces earlier', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'announce meeting at 7',
      'announce dinner at 8',  // New draft
      'send'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[1].action).toBe('draft_write')
    expect(results[1].response).toContain('dinner')
    expect(results[2].action).toBe('draft_send')
  })
})

// ============================================
// ADMIN VS NON-ADMIN TESTS
// ============================================

describe('Admin vs Non-Admin Behavior', () => {
  test('Admin can create polls', async () => {
    const results = await simulateConversation(createAdminUser(), [
      'poll who is coming',
      'send'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[1].action).toBe('draft_send')
  })
  
  test('Regular user can create polls', async () => {
    const results = await simulateConversation(createRegularUser(), [
      'poll who is coming',
      'send'
    ])
    
    expect(results[0].action).toBe('draft_write')
    expect(results[1].action).toBe('draft_send')
  })
  
  test('Both can ask for help', async () => {
    const adminResults = await simulateConversation(createAdminUser(), ['help'])
    const userResults = await simulateConversation(createRegularUser(), ['help'])
    
    expect(adminResults[0].action).toBe('capability_query')
    expect(userResults[0].action).toBe('capability_query')
    
    // Everyone should see announcement/poll capabilities
    expect(adminResults[0].response.toLowerCase()).toMatch(/announce/)
    expect(userResults[0].response.toLowerCase()).toMatch(/announce/)
  })
  
  test('Both can ask questions', async () => {
    const adminResults = await simulateConversation(createAdminUser(), ['when is the meeting'])
    const userResults = await simulateConversation(createRegularUser(), ['when is the meeting'])
    
    expect(adminResults[0].action).toBe('content_query')
    expect(userResults[0].action).toBe('content_query')
  })
})
