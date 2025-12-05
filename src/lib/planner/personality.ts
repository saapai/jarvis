/**
 * Personality Engine
 * Transforms responses with Jarvis's sassy, witty, slightly mean personality
 */

import { ToneLevel, PersonalityConfig, DEFAULT_PERSONALITY } from './types'

// ============================================
// EMOJI HELPERS
// ============================================

/**
 * Check if string ends with an emoji
 * Uses simple pattern matching without Unicode flag
 */
function endsWithEmoji(str: string): boolean {
  if (!str) return false
  // Check last few characters for common emoji patterns
  const lastChars = str.slice(-4)
  // Match common emoji ranges (simplified, no Unicode flag)
  return /[\u2600-\u27BF]$/.test(lastChars) || 
         /\uD83C[\uDF00-\uDFFF]$/.test(lastChars) ||
         /\uD83D[\uDC00-\uDE4F]$/.test(lastChars) ||
         /\uD83D[\uDE80-\uDEFF]$/.test(lastChars)
}

/**
 * Remove emoji from string
 * Uses simple pattern matching without Unicode flag
 */
export function removeEmoji(str: string): string {
  if (!str) return ''
  // Remove emoji using simple patterns (no Unicode flag needed)
  return str
    .replace(/[\u2600-\u27BF]/g, '') // Miscellaneous symbols
    .replace(/\uD83C[\uDF00-\uDFFF]/g, '') // Emoji with D83C prefix
    .replace(/\uD83D[\uDC00-\uDE4F]/g, '') // Emoticons
    .replace(/\uD83D[\uDE80-\uDEFF]/g, '') // Transport symbols
    .replace(/\uD83E[\uDD00-\uDDFF]/g, '') // Additional emoji
    .trim()
}

// ============================================
// TONE DETECTION
// ============================================

interface ToneAnalysis {
  isInsult: boolean
  isAggressive: boolean
  isFriendly: boolean
  isNeutral: boolean
  energy: 'low' | 'medium' | 'high'
}

/**
 * Analyze the tone of incoming message
 */
export function analyzeTone(message: string): ToneAnalysis {
  const lower = message.toLowerCase()
  
  // Insult patterns
  const insultPatterns = [
    /\b(stupid|dumb|idiot|moron|suck|trash|garbage|useless|worst|hate you|fuck|shit|ass|bitch)\b/i,
    /\byou('re| are) (bad|terrible|awful|annoying|the worst)\b/i,
    /\b(shut up|go away|leave me alone|stop)\b/i
  ]
  
  const isInsult = insultPatterns.some(p => p.test(lower))
  
  // Aggressive patterns
  const aggressivePatterns = [
    /!{2,}/,  // Multiple exclamation marks
    /[A-Z]{3,}/,  // ALL CAPS words
    /\b(wtf|wth|omg|bruh)\b/i,
    /\b(seriously|really|come on|ugh)\b/i
  ]
  
  const isAggressive = aggressivePatterns.some(p => p.test(message))
  
  // Friendly patterns
  const friendlyPatterns = [
    /\b(thanks|thank you|please|appreciate|love|awesome|great|nice)\b/i,
    /\b(hey|hi|hello|yo|sup)\b/i,
    /😊|😄|🙏|❤️|👍|🔥/
  ]
  
  const isFriendly = friendlyPatterns.some(p => p.test(message))
  
  // Energy level
  let energy: 'low' | 'medium' | 'high' = 'medium'
  if (message.length < 10 || /^(k|ok|sure|fine|whatever)$/i.test(lower)) {
    energy = 'low'
  } else if (isInsult || isAggressive || message.includes('!') || /[A-Z]{2,}/.test(message)) {
    energy = 'high'
  }
  
  return {
    isInsult,
    isAggressive,
    isFriendly,
    isNeutral: !isInsult && !isAggressive && !isFriendly,
    energy
  }
}

// ============================================
// RESPONSE TRANSFORMERS
// ============================================

/**
 * Add sass to a response based on tone level
 */
function addSass(response: string, level: ToneLevel): string {
  const sassyPrefixes = {
    mild: [
      'okay so ',
      'alright ',
      'fine ',
      'look ',
      ''
    ],
    medium: [
      'ugh fine ',
      'okay okay ',
      'yeah yeah ',
      'sigh... ',
      'if you insist... '
    ],
    spicy: [
      'oh my god fine ',
      'jfc okay ',
      'bro... ',
      'seriously? okay ',
      'do i have to do everything around here? '
    ]
  }
  
  const sassySuffixes = {
    mild: [
      '',
      ' 👀',
      ' ✨',
      ''
    ],
    medium: [
      ' 💅',
      ' anyway',
      ' there you go',
      ' happy?'
    ],
    spicy: [
      ' you\'re welcome btw',
      ' i guess',
      ' smh',
      ' 🙄'
    ]
  }
  
  const prefixes = sassyPrefixes[level]
  const suffixes = sassySuffixes[level]
  
  // Random selection
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)]
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)]
  
  // Don't double-prefix if response already starts with similar
  let result = response
  if (!result.toLowerCase().startsWith('okay') && 
      !result.toLowerCase().startsWith('alright') &&
      !result.toLowerCase().startsWith('fine') &&
      !result.toLowerCase().startsWith('ugh')) {
    result = prefix + result
  }
  
  // Don't double-suffix if response already ends with emoji
  if (!endsWithEmoji(result)) {
    result = result + suffix
  }
  
  return result
}

/**
 * Generate comeback for insults
 */
function generateComeback(userMessage: string): string {
  const comebacks = [
    "wow creative. anyway, need something?",
    "ouch. my feelings. anyway...",
    "that's nice. you done?",
    "k. you done venting or what?",
    "sick burn. now what do you actually want?",
    "imagine taking time out of your day to text that lmao",
    "ok and? i'm still here unfortunately for you",
    "that's crazy. so what do you need?",
    "bold words from someone texting a bot 💀",
    "noted. moving on..."
  ]
  
  return comebacks[Math.floor(Math.random() * comebacks.length)]
}

/**
 * Generate response to thank you
 */
function handleThankYou(): string {
  const responses = [
    "yeah yeah you're welcome",
    "don't mention it. seriously don't",
    "that's what i'm here for i guess",
    "np 👍",
    "sure thing",
    "finally some appreciation around here",
    "i know i'm amazing, thanks for noticing",
    "you're welcome, as always"
  ]
  
  return responses[Math.floor(Math.random() * responses.length)]
}

/**
 * Generate response to greetings
 */
function handleGreeting(userName: string | null): string {
  const name = userName || 'you'
  const greetings = [
    `sup ${name}`,
    `hey ${name}. what do you need?`,
    `oh look who it is. hey ${name}`,
    `${name}! what's up`,
    `hey. what can i do for you`,
    `yo ${name}`,
    `${name} hey hey. whatcha need?`
  ]
  
  return greetings[Math.floor(Math.random() * greetings.length)]
}

// ============================================
// MAIN PERSONALITY FUNCTION
// ============================================

export interface PersonalityInput {
  baseResponse: string
  userMessage: string
  userName: string | null
  config?: PersonalityConfig
}

/**
 * Apply personality to a response
 */
export function applyPersonality(input: PersonalityInput): string {
  const { baseResponse, userMessage, userName, config = DEFAULT_PERSONALITY } = input
  
  const tone = analyzeTone(userMessage)
  
  // Handle special cases first
  
  // 1. Insults -> comebacks
  if (tone.isInsult && config.matchUserEnergy) {
    return generateComeback(userMessage)
  }
  
  // 2. Thank you responses
  if (/\b(thanks|thank you|thx|ty)\b/i.test(userMessage.toLowerCase())) {
    return handleThankYou()
  }
  
  // 3. Pure greetings (just "hi", "hey", etc.)
  if (/^(hi|hey|hello|yo|sup|what'?s up|wassup)$/i.test(userMessage.trim())) {
    return handleGreeting(userName)
  }
  
  // 4. Determine tone level based on context
  let toneLevel = config.baseTone
  
  if (config.matchUserEnergy) {
    if (tone.isAggressive || tone.energy === 'high') {
      // Match their energy
      toneLevel = 'spicy'
    } else if (tone.isFriendly) {
      // Be slightly nicer (but still sassy)
      toneLevel = 'mild'
    }
  }
  
  // 5. Apply sass to the base response
  let result = addSass(baseResponse, toneLevel)
  
  // 6. Lowercase the start (Jarvis doesn't do proper capitalization)
  if (result.length > 0 && /^[A-Z]/.test(result) && !/^[A-Z]{2,}/.test(result)) {
    result = result.charAt(0).toLowerCase() + result.slice(1)
  }
  
  return result
}

// ============================================
// RESPONSE TEMPLATES
// ============================================

export const TEMPLATES = {
  // Draft operations
  draftCreated: (type: string, content: string) => 
    `📝 here's the ${type}:\n\n"${content}"\n\nreply "send" to blast it out or tell me to change it`,
  
  draftUpdated: (content: string) =>
    `updated:\n\n"${content}"\n\nlooks good? say "send" or keep editing`,
  
  draftSent: (count: number) =>
    `done. sent to ${count} people 💅`,
  
  draftCancelled: () =>
    `scrapped. let me know if you wanna start over`,
  
  askForContent: (type: string) =>
    type === 'poll' 
      ? `what do you wanna ask everyone?`
      : `what do you wanna announce?`,
  
  // Errors
  noDraft: () =>
    `you don't have anything drafted rn. wanna make an announcement or poll?`,
  
  notAdmin: () =>
    `nice try but you can't do that. only admins can send announcements and polls`,
  
  // Content queries
  noResults: () =>
    `idk what you're asking about tbh. try being more specific?`,
  
  // Capability queries  
  capabilities: (isAdmin: boolean) => isAdmin
    ? `i can:\n📢 send announcements ("announce [message]")\n📊 create polls ("poll [question]")\n💬 answer questions about the org\n\nor just chat if you're bored`
    : `i can:\n💬 answer questions about the org\n📊 respond to polls\n\njust text me what you need`,
  
  // Default fallback
  confused: () =>
    `not sure what you mean. need help with something?`
}

// ============================================
// QUICK RESPONSES
// ============================================

/**
 * Get a quick sassy response for simple inputs
 */
export function getQuickResponse(input: string): string | null {
  const lower = input.toLowerCase().trim()
  
  const quickResponses: Record<string, string[]> = {
    'ok': ['k', 'cool', '👍', 'noted'],
    'k': ['ok', 'yep', '👍'],
    'lol': ['glad you find this amusing', 'lmao', '😂', 'hilarious'],
    'lmao': ['ikr', '💀', 'fr'],
    'bruh': ['what', 'bruh indeed', '🤨'],
    'nice': ['thanks i guess', 'ikr', '✨'],
    'cool': ['i know', 'yep', '👍'],
    'wow': ['ikr amazing', 'i know right', '✨'],
    'damn': ['right?', 'ikr', 'fr'],
    'true': ['facts', 'yep', 'fr fr'],
    'fr': ['fr fr', 'on god', 'facts'],
    'bet': ['bet', '👍', 'cool'],
    'ight': ['aight', '👍', 'bet'],
    'aight': ['cool', '👍', 'bet'],
    'word': ['word', 'fr', '👍'],
    'facts': ['fr', 'on god', 'yep'],
    'idk': ['same tbh', 'fair enough', 'mood'],
    'nvm': ['ok', 'sure', 'k'],
    'mb': ['all good', 'np', 'you\'re fine'],
    'my bad': ['all good', 'np', 'you\'re fine'],
    '?': ['use your words', 'what', '🤨'],
    '??': ['???', 'huh', 'speak'],
    '???': ['bro what', 'use words pls', '🤨']
  }
  
  const responses = quickResponses[lower]
  if (responses) {
    return responses[Math.floor(Math.random() * responses.length)]
  }
  
  return null
}

