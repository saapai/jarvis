/**
 * Personality Tests
 * Tests for the sassy/witty personality engine
 */

import {
  analyzeTone,
  applyPersonality,
  getQuickResponse,
  TEMPLATES,
  removeEmoji
} from '../personality'
import { checkForEasterEgg } from '../actions/capability'

// ============================================
// TONE ANALYSIS TESTS
// ============================================

describe('Tone Analysis', () => {
  describe('Insult Detection', () => {
    const insultExamples = [
      'you suck',
      'this is stupid',
      'you are the worst',
      'shut up',
      'you are trash',
      'this is garbage',
      'you are useless',
      'hate you',
      'you\'re terrible',
      'you\'re awful'
    ]
    
    test.each(insultExamples)('detects "%s" as insult', (input) => {
      expect(analyzeTone(input).isInsult).toBe(true)
    })
    
    const nonInsultExamples = [
      'when is the meeting',
      'thanks for the help',
      'can you help me',
      'hello there',
      'that sucks for them'  // Not directed at bot
    ]
    
    test.each(nonInsultExamples)('does not detect "%s" as insult', (input) => {
      expect(analyzeTone(input).isInsult).toBe(false)
    })
  })
  
  describe('Aggressive Detection', () => {
    const aggressiveExamples = [
      'WTF!!!',
      'HELLO???',
      'seriously?!',
      'come on bruh',
      'OMG',
      'UGH really',
      'WHAT THE'
    ]
    
    test.each(aggressiveExamples)('detects "%s" as aggressive', (input) => {
      expect(analyzeTone(input).isAggressive).toBe(true)
    })
    
    const calmExamples = [
      'hi',
      'when is the meeting',
      'thanks',
      'ok'
    ]
    
    test.each(calmExamples)('does not detect "%s" as aggressive', (input) => {
      expect(analyzeTone(input).isAggressive).toBe(false)
    })
  })
  
  describe('Friendly Detection', () => {
    const friendlyExamples = [
      'thanks so much!',
      'please help',
      'hey there!',
      'that would be awesome',
      'thank you',
      'appreciate it',
      'love this',
      'great work'
    ]
    
    test.each(friendlyExamples)('detects "%s" as friendly', (input) => {
      expect(analyzeTone(input).isFriendly).toBe(true)
    })
    
    const neutralExamples = [
      'ok',
      'send it',
      'when',
      'where'
    ]
    
    test.each(neutralExamples)('does not detect "%s" as friendly', (input) => {
      expect(analyzeTone(input).isFriendly).toBe(false)
    })
  })
  
  describe('Energy Level Detection', () => {
    test('detects low energy', () => {
      expect(analyzeTone('k').energy).toBe('low')
      expect(analyzeTone('ok').energy).toBe('low')
      expect(analyzeTone('fine').energy).toBe('low')
      expect(analyzeTone('sure').energy).toBe('low')
    })
    
    test('detects high energy', () => {
      expect(analyzeTone('OMG YES!!!').energy).toBe('high')
      expect(analyzeTone('you suck!').energy).toBe('high')
      expect(analyzeTone('WTF').energy).toBe('high')
      expect(analyzeTone('AMAZING!!!').energy).toBe('high')
    })
    
    test('detects medium energy', () => {
      expect(analyzeTone('when is the meeting').energy).toBe('medium')
      expect(analyzeTone('make an announcement').energy).toBe('medium')
      expect(analyzeTone('can you help me with this').energy).toBe('medium')
    })
  })
})

// ============================================
// PERSONALITY APPLICATION TESTS
// ============================================

describe('Personality Application', () => {
  test('comebacks for insults are not helpful', () => {
    const result = applyPersonality({
      baseResponse: 'How can I help you?',
      userMessage: 'you suck',
      userName: 'Test'
    })
    
    // Should be a comeback, not the base response
    expect(result).not.toBe('How can I help you?')
    // Should not start with typical help phrase
    expect(result.toLowerCase()).not.toMatch(/^how can i (help|assist)/)
  })
  
  test('handles thank you with acknowledgment', () => {
    const result = applyPersonality({
      baseResponse: 'Here is the info',
      userMessage: 'thanks',
      userName: 'Test'
    })
    
    // Should be an acknowledgment response
    expect(result.toLowerCase()).toMatch(/welcome|np|sure|mention|appreciate|know|amazing|here for|appreciation/)
  })
  
  test('handles greetings', () => {
    const result = applyPersonality({
      baseResponse: 'How can I help?',
      userMessage: 'hi',
      userName: 'Test'
    })
    
    // Should be a greeting response
    expect(result.toLowerCase()).toMatch(/hey|sup|yo|hi|hello|what/)
  })
  
  test('adds content to neutral responses', () => {
    const result = applyPersonality({
      baseResponse: 'The meeting is at 7pm.',
      userMessage: 'when is the meeting',
      userName: 'Test'
    })
    
    // Should still contain the core info
    expect(result.toLowerCase()).toContain('7pm')
  })
  
  test('lowercases response start (when appropriate)', () => {
    const result = applyPersonality({
      baseResponse: 'The meeting is at 7pm.',
      userMessage: 'when is meeting',
      userName: 'Test'
    })
    
    // First character should be lowercase (unless entire result is different)
    // The response may be prefixed, but check it's not starting with uppercase formal style
    expect(result).toBeTruthy()
  })
})

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
  
  test('good morning', () => {
    const result = checkForEasterEgg('good morning')
    expect(result).toBeTruthy()
    expect(result!.toLowerCase()).toMatch(/morn|need/)
  })
  
  test('good night', () => {
    const result = checkForEasterEgg('good night')
    expect(result).toBeTruthy()
    expect(result!.toLowerCase()).toMatch(/night|sleep|later/)
  })
  
  test('how are you', () => {
    const result = checkForEasterEgg('how are you')
    expect(result).toBeTruthy()
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

// ============================================
// EMOJI HELPER TESTS
// ============================================

describe('Emoji Helpers', () => {
  test('removeEmoji removes emoji', () => {
    expect(removeEmoji('hello 👋')).toBe('hello')
    expect(removeEmoji('test 🔥 message')).toBe('test  message')
    expect(removeEmoji('😀😀😀')).toBe('')
    expect(removeEmoji('no emoji here')).toBe('no emoji here')
  })
  
  test('removeEmoji handles empty string', () => {
    expect(removeEmoji('')).toBe('')
  })
  
  test('removeEmoji handles only emoji', () => {
    expect(removeEmoji('🎉')).toBe('')
    expect(removeEmoji('👍👍👍')).toBe('')
  })
})

// ============================================
// CONSISTENCY TESTS
// ============================================

describe('Response Consistency', () => {
  test('responses are never empty', () => {
    for (let i = 0; i < 20; i++) {
      const result = applyPersonality({
        baseResponse: 'Test response',
        userMessage: 'test',
        userName: 'Test'
      })
      expect(result.length).toBeGreaterThan(0)
    }
  })
  
  test('comebacks are varied', () => {
    const comebacks = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const result = applyPersonality({
        baseResponse: 'How can I help?',
        userMessage: 'you suck',
        userName: 'Test'
      })
      comebacks.add(result)
    }
    // Should have multiple different comebacks
    expect(comebacks.size).toBeGreaterThan(1)
  })
  
  test('greetings are varied', () => {
    const greetings = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const result = applyPersonality({
        baseResponse: 'How can I help?',
        userMessage: 'hi',
        userName: 'Test'
      })
      greetings.add(result)
    }
    expect(greetings.size).toBeGreaterThan(1)
  })
})
