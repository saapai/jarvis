/**
 * Personality Tests — quick responses, easter eggs, and response templates.
 * The rule-based tone/sass engine was removed, so its tests went with it.
 */

import { getQuickResponse, TEMPLATES } from '../personality'
import { checkForEasterEgg } from '../actions/capability'

// ============================================
// QUICK RESPONSE TESTS
// ============================================

describe('Quick Responses', () => {
  const quickInputs = [
    'ok', 'k', 'lol', 'lmao', 'bruh', 'nice', 'cool', 
    'fr', 'bet', 'ight', 'aight', 'word', 'facts',
    'idk', 'nvm', 'mb', '?', '??', '???'
  ]
  
  test.each(quickInputs)('returns response for "%s"', (input) => {
    expect(getQuickResponse(input)).toBeTruthy()
  })
  
  const unknownInputs = [
    'when is the meeting',
    'make an announcement',
    'asdfasdf',
    'tell me about the event'
  ]
  
  test.each(unknownInputs)('returns null for "%s"', (input) => {
    expect(getQuickResponse(input)).toBeNull()
  })
  
  test('is case insensitive', () => {
    expect(getQuickResponse('OK')).toBeTruthy()
    expect(getQuickResponse('LOL')).toBeTruthy()
    expect(getQuickResponse('Bruh')).toBeTruthy()
    expect(getQuickResponse('LMAO')).toBeTruthy()
  })
  
  test('quick responses are varied (randomized)', () => {
    const responses = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const result = getQuickResponse('ok')
      if (result) responses.add(result)
    }
    // Should have at least 2 different responses
    expect(responses.size).toBeGreaterThan(1)
  })
})

// ============================================
// EASTER EGG TESTS
// ============================================

describe('Easter Eggs', () => {
  test('meaning of life', () => {
    const result = checkForEasterEgg('what is the meaning of life')
    expect(result).toBeTruthy()
    expect(result).toContain('42')
  })
  
  test('tell me a joke', () => {
    const result = checkForEasterEgg('tell me a joke')
    expect(result).toBeTruthy()
    expect(result!.length).toBeGreaterThan(10)
  })
  
  test('i love you', () => {
    const result = checkForEasterEgg('i love you')
    expect(result).toBeTruthy()
  })
  
  // Greetings/small-talk ("good morning", "good night", "how are you") are NO LONGER
  // canned easter eggs — they route through the LLM chat persona so replies are
  // varied and interactive instead of the old "is it? anyway what do you need" funnel.
  test('greetings/small-talk are not canned easter eggs (route to LLM)', () => {
    expect(checkForEasterEgg('good morning')).toBeNull()
    expect(checkForEasterEgg('good night')).toBeNull()
    expect(checkForEasterEgg('how are you')).toBeNull()
  })

  const nonEasterEggs = [
    'when is the meeting',
    'make an announcement',
    'poll who is coming',
    'help'
  ]
  
  test.each(nonEasterEggs)('returns null for "%s"', (input) => {
    expect(checkForEasterEgg(input)).toBeNull()
  })
})

// ============================================
// TEMPLATE TESTS
// ============================================

describe('Response Templates', () => {
  test('draftCreated includes content and send instruction', () => {
    const result = TEMPLATES.draftCreated('announcement', 'test message')
    expect(result).toContain('test message')
    expect(result.toLowerCase()).toContain('send')
  })
  
  test('draftUpdated includes content', () => {
    const result = TEMPLATES.draftUpdated('updated message')
    expect(result).toContain('updated message')
  })
  
  test('draftSent includes count', () => {
    const result = TEMPLATES.draftSent(15)
    expect(result).toContain('15')
  })
  
  test('draftSent with different counts', () => {
    expect(TEMPLATES.draftSent(0)).toContain('0')
    expect(TEMPLATES.draftSent(1)).toContain('1')
    expect(TEMPLATES.draftSent(100)).toContain('100')
  })
  
  test('askForContent differs by type', () => {
    const announcement = TEMPLATES.askForContent('announcement')
    const poll = TEMPLATES.askForContent('poll')
    expect(announcement).not.toBe(poll)
    expect(announcement.toLowerCase()).toMatch(/announce|say/)
    expect(poll.toLowerCase()).toMatch(/poll|ask/)
  })
  
  test('capabilities include announcements for everyone', () => {
    const admin = TEMPLATES.capabilities(true)
    const user = TEMPLATES.capabilities(false)
    expect(admin.toLowerCase()).toContain('announce')
    expect(user.toLowerCase()).toContain('announce')
    expect(user).toBe(admin)
  })
  
  test('noDraft response', () => {
    const result = TEMPLATES.noDraft()
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(10)
  })
  
  test('notAdmin response now encourages sending', () => {
    const result = TEMPLATES.notAdmin()
    expect(result).toBeTruthy()
    expect(result.toLowerCase()).toMatch(/everyone can send|what do you want to say/)
  })
  
  test('noResults response', () => {
    const result = TEMPLATES.noResults()
    expect(result).toBeTruthy()
  })
  
  test('confused response', () => {
    const result = TEMPLATES.confused()
    expect(result).toBeTruthy()
    expect(result.toLowerCase()).toMatch(/not sure|help|\?/)
  })
})
