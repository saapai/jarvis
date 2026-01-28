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
  if (isInsult || isAggressive || message.includes('!') || /[A-Z]{2,}/.test(message)) {
    energy = 'high'
  } else if (message.length < 10 || /^(k|ok|sure|fine|whatever)$/i.test(lower)) {
    energy = 'low'
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
 * @param skipEmojis - if true, avoid adding emoji suffixes (for informational content)
 */
function addSass(response: string, level: ToneLevel, skipEmojis: boolean = false): string {
  // If response looks like factual information (long, has dates/times/etc), be minimal
  const isFactual = response.length > 100 || /\b(at|on|from|to|in|when|where|who)\b/.test(response.toLowerCase())
  
  const sassyPrefixes = {
    mild: [
      'okay so ',
      'alright ',
      '',
      ''
    ],
    medium: [
      'okay okay ',
      'yeah yeah ',
      '',
      'alright '
    ],
    spicy: [
      'okay fine ',
      'alright ',
      'listen ',
      ''
    ]
  }
  
  const sassySuffixes = {
    mild: [
      '',
      ' 👍',
      '',
      ''
    ],
    medium: [
      ' there you go',
      '',
      ' anyway',
      ''
    ],
    spicy: [
      ' you\'re welcome btw',
      ' happy?',
      '',
      ''
    ]
  }
  
  const prefixes = sassyPrefixes[level]
  const suffixes = sassySuffixes[level]
  
  // Random selection - favor empty options for factual content
  const prefixIndex = isFactual ? Math.floor(Math.random() * prefixes.length * 0.7) : Math.floor(Math.random() * prefixes.length)
  const prefix = prefixes[Math.min(prefixIndex, prefixes.length - 1)]
  
  // Don't double-prefix if response already starts with similar
  let result = response
  if (!result.toLowerCase().startsWith('okay') && 
      !result.toLowerCase().startsWith('alright') &&
      !result.toLowerCase().startsWith('fine') &&
      !result.toLowerCase().startsWith('ugh')) {
    result = prefix + result
  }
  
  // Skip emoji suffixes if requested or if response already has emoji
  if (!skipEmojis && !endsWithEmoji(result) && !isFactual) {
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)]
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
  useLLM?: boolean  // If true, use LLM for personality rendering
  conversationHistory?: string  // Optional conversation history for context
}

/**
 * Apply personality using LLM for more dynamic responses
 */
async function applyPersonalityLLM(
  baseResponse: string,
  userMessage: string,
  userName: string | null,
  config: PersonalityConfig
): Promise<string> {
  try {
    const tone = analyzeTone(userMessage)
    const toneLevel = config.matchUserEnergy && tone.isAggressive ? 'spicy' : config.baseTone
    
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    
    const systemPrompt = `You are Jarvis, a sassy AI assistant for an organization via SMS.

PERSONALITY:
- Clever and witty, slightly sarcastic but ultimately helpful
- Lowercase style, minimal punctuation (you're too cool for proper grammar)
- Very sparing with emojis (0-1 per message, only when it adds meaning)
- Concise - SMS-friendly, under 160 chars when possible

TONE: ${toneLevel}
- mild: gentle teasing, friendly
- medium: clear sass, confident
- spicy: sharp wit, match their energy if they're rude

CRITICAL RULES:
- For factual/informational responses: be direct, minimal sass, NO excessive emojis
- For content queries: present info cleanly without repetitive phrases
- For casual chat: more personality, but still concise
- Match user energy: ${config.matchUserEnergy ? 'mirror their tone' : 'stay consistent'}
- Never use the same catchphrase twice in a row
- Keep it natural and varied

Transform the base response into your voice:`

    const messages: any[] = [
      { role: 'system', content: systemPrompt }
    ]
    
    // Add conversation history if available
    if (conversationHistory) {
      messages.push({
        role: 'user',
        content: `Previous conversation:\n${conversationHistory}\n\nCurrent message: "${userMessage}"\nBase response: "${baseResponse}"\n\nYour response (in Jarvis's voice, considering the conversation context):`
      })
    } else {
      messages.push({
        role: 'user',
        content: `User: "${userMessage}"\nBase response: "${baseResponse}"\n\nYour response (in Jarvis's voice):`
      })
    }
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 150
    })
    
    return response.choices[0].message.content || baseResponse
  } catch (error) {
    console.error('[Personality] LLM error:', error)
    // Fallback to rule-based personality
    const skipEmojis = baseResponse.length > 80
    return addSass(baseResponse, config.baseTone, skipEmojis)
  }
}

/**
 * Apply personality to a response (synchronous version using rules)
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
  // Skip emojis for longer informational responses
  const skipEmojis = baseResponse.length > 80
  let result = addSass(baseResponse, toneLevel, skipEmojis)
  
  // 6. Lowercase the start (Jarvis doesn't do proper capitalization)
  if (result.length > 0 && /^[A-Z]/.test(result) && !/^[A-Z]{2,}/.test(result)) {
    result = result.charAt(0).toLowerCase() + result.slice(1)
  }
  
  return result
}

/**
 * Apply personality to a response (async version with optional LLM)
 */
export async function applyPersonalityAsync(input: PersonalityInput): Promise<string> {
  const { baseResponse, userMessage, userName, config = DEFAULT_PERSONALITY, useLLM = false, conversationHistory } = input
  
  const tone = analyzeTone(userMessage)
  
  // Handle special cases first (always use rules for these)
  
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
  
  // 4. Use LLM for non-template responses if requested
  if (useLLM && process.env.OPENAI_API_KEY) {
    return await applyPersonalityLLM(baseResponse, userMessage, userName, config)
  }
  
  // 5. Fallback to rule-based personality
  return applyPersonality(input)
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
    `done. sent to ${count} people`,
  
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
    `everyone can send announcements and polls now. what do you want to say?`,
  
  // Content queries
  noResults: () =>
    `idk what you're asking about tbh. try being more specific?`,
  
  // Capability queries  
  capabilities: (_isAdmin: boolean) =>
    `i can:\n📢 send announcements ("announce [message]")\n📊 create polls ("poll [question]")\n💬 answer questions about the org\n\njust text me what you need or tell me what to send`,
  
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
