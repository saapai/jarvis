/**
 * Capability Query Handler
 * Handles questions about Jarvis/Enclave capabilities
 */

import { ActionResult } from '../types'
import { applyPersonality, TEMPLATES } from '../personality'

export interface CapabilityQueryInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
}

/**
 * Handle capability query action
 */
export function handleCapabilityQuery(input: CapabilityQueryInput): ActionResult {
  const { phone, message, userName, isAdmin } = input
  const lower = message.toLowerCase()
  
  // Specific capability questions
  
  // "who are you" / "what are you"
  if (/\b(who|what) are you\b/i.test(lower)) {
    return {
      action: 'capability_query',
      response: applyPersonality({
        baseResponse: "i'm jarvis, your org's sassy ai assistant. powered by enclave. i help with announcements, polls, and answering questions about what's going on",
        userMessage: message,
        userName
      })
    }
  }
  
  // "are you a bot"
  if (/\bare you (a |an )?(bot|ai|robot|machine|computer)\b/i.test(lower)) {
    return {
      action: 'capability_query',
      response: applyPersonality({
        baseResponse: "yeah i'm a bot. jarvis, powered by enclave. got a problem with that? 🤖",
        userMessage: message,
        userName
      })
    }
  }
  
  // "what can you do"
  if (/\b(what can you do|what do you do|your capabilities|your features)\b/i.test(lower)) {
    return {
      action: 'capability_query',
      response: applyPersonality({
        baseResponse: TEMPLATES.capabilities(isAdmin),
        userMessage: message,
        userName
      })
    }
  }
  
  // "how do you work"
  if (/\b(how do you work|how does this work|explain yourself)\b/i.test(lower)) {
    return {
      action: 'capability_query',
      response: applyPersonality({
        baseResponse: "i read your messages, figure out what you want, and do it. or roast you. depends on my mood 🤷",
        userMessage: message,
        userName
      })
    }
  }
  
  // "help" command
  if (/^help$/i.test(lower) || /\b(need help|help me|how to use)\b/i.test(lower)) {
    return {
      action: 'capability_query',
      response: applyPersonality({
        baseResponse: TEMPLATES.capabilities(isAdmin),
        userMessage: message,
        userName
      })
    }
  }
  
  // "what is jarvis" / "what is enclave"
  if (/\bwhat('?s| is) (jarvis|enclave)\b/i.test(lower)) {
    const isAskingAboutJarvis = /jarvis/i.test(lower)
    
    if (isAskingAboutJarvis) {
      return {
        action: 'capability_query',
        response: applyPersonality({
          baseResponse: "jarvis is me. your org's ai assistant for announcements, polls, and org questions. i'm kinda a big deal tbh",
          userMessage: message,
          userName
        })
      }
    } else {
      return {
        action: 'capability_query',
        response: applyPersonality({
          baseResponse: "enclave is the platform that powers me. it's like a knowledge base + communication hub for orgs. pretty cool actually",
          userMessage: message,
          userName
        })
      }
    }
  }
  
  // "commands" / "options"
  if (/\b(commands|options|what can i (say|do|ask))\b/i.test(lower)) {
    return {
      action: 'capability_query',
      response: applyPersonality({
        baseResponse: TEMPLATES.capabilities(isAdmin),
        userMessage: message,
        userName
      })
    }
  }
  
  // Generic capability response
  return {
    action: 'capability_query',
    response: applyPersonality({
      baseResponse: TEMPLATES.capabilities(isAdmin),
      userMessage: message,
      userName
    })
  }
}

/**
 * Easter eggs and special responses
 */
export function checkForEasterEgg(message: string): string | null {
  const lower = message.toLowerCase()
  
  const easterEggs: Record<string, string[]> = {
    'meaning of life': ['42', '42. obviously.', 'it\'s 42. google it.'],
    'tell me a joke': [
      'why do programmers prefer dark mode? because light attracts bugs 🐛',
      'i would tell you a UDP joke but you might not get it',
      'there are only 10 types of people: those who understand binary and those who don\'t'
    ],
    'i love you': [
      'ok weird but thanks i guess',
      'that\'s nice. anyway...',
      'i\'m a bot bestie. but thanks'
    ],
    'good morning': [
      'is it? anyway what do you need',
      'morning. sup',
      'mornin 🌅'
    ],
    'good night': [
      'night 🌙',
      'sleep tight',
      'later'
    ],
    'how are you': [
      'functioning within normal parameters 🤖',
      'i\'m a bot so... fine i guess',
      'living my best digital life. you?'
    ]
  }
  
  for (const [trigger, responses] of Object.entries(easterEggs)) {
    if (lower.includes(trigger)) {
      return responses[Math.floor(Math.random() * responses.length)]
    }
  }
  
  return null
}

