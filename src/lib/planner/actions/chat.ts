/**
 * Chat Action Handler
 * Handles casual conversation, banter, and fallback responses
 */

import { ActionResult, Draft } from '../types'
import { getDraft, clearDraft } from '../history'
import { applyPersonality, getQuickResponse, TEMPLATES } from '../personality'
import { checkForEasterEgg } from './capability'

export interface ChatActionInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
}

/**
 * Handle chat/banter action
 */
export function handleChat(input: ChatActionInput): ActionResult {
  const { phone, message, userName, isAdmin } = input
  const lower = message.toLowerCase().trim()
  
  // Check for draft cancellation first
  if (/^(cancel|nvm|nevermind|never mind|delete|discard|forget it|scratch that)$/i.test(lower)) {
    const draft = getDraft(phone)
    if (draft) {
      clearDraft(phone)
      return {
        action: 'chat',
        response: applyPersonality({
          baseResponse: TEMPLATES.draftCancelled(),
          userMessage: message,
          userName
        }),
        newDraft: undefined
      }
    }
  }
  
  // Check for quick responses (ok, lol, etc.)
  const quickResponse = getQuickResponse(message)
  if (quickResponse) {
    return {
      action: 'chat',
      response: quickResponse
    }
  }
  
  // Check for easter eggs
  const easterEgg = checkForEasterEgg(message)
  if (easterEgg) {
    return {
      action: 'chat',
      response: easterEgg
    }
  }
  
  // Check for greeting
  if (/^(hi|hey|hello|yo|sup|what'?s up|wassup|hola|heyo)$/i.test(lower)) {
    const greetings = [
      `sup ${userName || 'you'}`,
      `hey ${userName || 'there'}. what's up`,
      `yo. need something?`,
      `hey hey 👋`
    ]
    return {
      action: 'chat',
      response: greetings[Math.floor(Math.random() * greetings.length)]
    }
  }
  
  // Check for goodbye
  if (/^(bye|goodbye|later|peace|cya|see ya|ttyl|gtg)$/i.test(lower)) {
    const goodbyes = [
      'later 👋',
      'peace ✌️',
      'bye',
      'k bye',
      'ttyl'
    ]
    return {
      action: 'chat',
      response: goodbyes[Math.floor(Math.random() * goodbyes.length)]
    }
  }
  
  // Check for thank you
  if (/\b(thanks|thank you|thx|ty|appreciate)\b/i.test(lower)) {
    const thanks = [
      "yeah yeah you're welcome",
      "np 👍",
      "sure thing",
      "don't mention it. seriously",
      "i know i'm helpful"
    ]
    return {
      action: 'chat',
      response: thanks[Math.floor(Math.random() * thanks.length)]
    }
  }
  
  // Check for apology
  if (/^(sorry|my bad|mb|oops|apologies)$/i.test(lower) || /\b(i'?m sorry|my apologies)\b/i.test(lower)) {
    const forgiveness = [
      "all good",
      "you're fine",
      "it happens",
      "np",
      "don't worry about it"
    ]
    return {
      action: 'chat',
      response: forgiveness[Math.floor(Math.random() * forgiveness.length)]
    }
  }
  
  // Check if there's an active draft to remind about
  const draft = getDraft(phone)
  if (draft && draft.status === 'ready') {
    return {
      action: 'chat',
      response: applyPersonality({
        baseResponse: `btw you still have a ${draft.type} draft:\n\n"${draft.content}"\n\nwanna send it or nah?`,
        userMessage: message,
        userName
      })
    }
  }
  
  // Default confused response
  const confusedResponses = [
    "not sure what you mean. need help?",
    "huh? try again",
    "didn't get that. what do you need?",
    "🤔 you lost me. what's up?",
    "speak english pls. what do you want?",
    `idk what "${message.length > 20 ? message.substring(0, 20) + '...' : message}" means. help?`
  ]
  
  return {
    action: 'chat',
    response: applyPersonality({
      baseResponse: confusedResponses[Math.floor(Math.random() * confusedResponses.length)],
      userMessage: message,
      userName
    })
  }
}

/**
 * Generate response for when user just sends random stuff
 */
export function handleGibberish(message: string, userName: string | null): ActionResult {
  const responses = [
    "bro what",
    "huh",
    "???",
    "use words",
    "that's not a thing",
    "try again with actual words",
    "i don't speak whatever that was"
  ]
  
  return {
    action: 'chat',
    response: responses[Math.floor(Math.random() * responses.length)]
  }
}

/**
 * Handle empty or whitespace-only messages
 */
export function handleEmptyMessage(userName: string | null): ActionResult {
  const responses = [
    "you sent nothing",
    "?",
    "hello?",
    "you there?",
    "that was empty lol"
  ]
  
  return {
    action: 'chat',
    response: responses[Math.floor(Math.random() * responses.length)]
  }
}

