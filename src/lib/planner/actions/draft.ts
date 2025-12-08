/**
 * Draft Action Handler
 * Handles creating and editing announcement/poll drafts
 */

import {
  ActionResult,
  Draft,
  DraftType,
  createEmptyDraft,
  ClassificationResult
} from '../types'
import * as draftRepo from '@/lib/repositories/draftRepository'
import { extractContent } from '../classifier'
import { applyPersonality, TEMPLATES, removeEmoji } from '../personality'

export interface DraftActionInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
  classification: ClassificationResult
}

/**
 * Handle draft write/edit action
 */
export async function handleDraftWrite(input: DraftActionInput): Promise<ActionResult> {
  const { phone, message, userName, classification } = input
  
  const draftType = classification.subtype || 'announcement'
  const existingDraft = await draftRepo.getActiveDraft(phone)
  
  console.log(`[DraftWrite] Type: ${draftType}, Existing draft: ${existingDraft ? 'yes' : 'no'}`)
  
  // Case 1: No existing draft - determine if we have content or need to ask
  if (!existingDraft) {
    const content = extractContent(message, draftType)
    console.log(`[DraftWrite] Extracted content: "${content}"`)
    
    // If message was just a command without content, ask for it
    if (content.length < 5 || isJustCommand(message, draftType)) {
      console.log(`[DraftWrite] No content provided, asking for content...`)
      // Create empty draft in DB
      await draftRepo.createDraft(phone, draftType, '')
      const newDraft = createEmptyDraft(draftType)
      
      return {
        action: 'draft_write',
        response: applyPersonality({
          baseResponse: TEMPLATES.askForContent(draftType),
          userMessage: message,
          userName
        }),
        newDraft
      }
    }
    
    // We have content - create draft with it
    const formattedContent = formatContent(content, draftType)
    console.log(`[DraftWrite] Creating draft with content: "${formattedContent}"`)
    await draftRepo.createDraft(phone, draftType, formattedContent)
    
    const newDraft: Draft = {
      type: draftType,
      content: formattedContent,
      status: 'ready',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    
    return {
      action: 'draft_write',
      response: applyPersonality({
        baseResponse: TEMPLATES.draftCreated(draftType, newDraft.content),
        userMessage: message,
        userName
      }),
      newDraft
    }
  }
  
  // Case 2: Existing draft in 'drafting' state (waiting for content)
  if (existingDraft.status === 'drafting' && !existingDraft.content) {
    const content = formatContent(message.trim(), existingDraft.type)
    
    // Update draft in DB
    await draftRepo.updateDraftByPhone(phone, { draftText: content })
    
    const updatedDraft: Draft = {
      ...existingDraft,
      content,
      status: 'ready',
      updatedAt: Date.now()
    }
    
    return {
      action: 'draft_write',
      response: applyPersonality({
        baseResponse: TEMPLATES.draftCreated(existingDraft.type, content),
        userMessage: message,
        userName
      }),
      newDraft: updatedDraft
    }
  }
  
  // Case 3: Existing draft in 'ready' state - user is editing
  if (existingDraft.status === 'ready') {
    const editedContent = applyEdit(existingDraft.content, message, existingDraft.type)
    
    // Update draft in DB
    await draftRepo.updateDraftByPhone(phone, { draftText: editedContent })
    
    const updatedDraft: Draft = {
      ...existingDraft,
      content: editedContent,
      updatedAt: Date.now()
    }
    
    return {
      action: 'draft_write',
      response: applyPersonality({
        baseResponse: TEMPLATES.draftUpdated(editedContent),
        userMessage: message,
        userName
      }),
      newDraft: updatedDraft
    }
  }
  
  // Fallback
  return {
    action: 'draft_write',
    response: applyPersonality({
      baseResponse: TEMPLATES.confused(),
      userMessage: message,
      userName
    })
  }
}

// ============================================
// HELPERS
// ============================================

/**
 * Check if message is just a command without content
 */
function isJustCommand(message: string, type: DraftType): boolean {
  const lower = message.toLowerCase().trim()
  
  if (type === 'announcement') {
    return /^(announce|announcement|make an announcement|send an announcement|create an announcement)$/i.test(lower)
  } else {
    return /^(poll|make a poll|send a poll|create a poll|start a poll)$/i.test(lower)
  }
}

/**
 * Format content based on type
 */
function formatContent(content: string, type: DraftType): string {
  let formatted = content.trim()
  
  if (type === 'poll') {
    // Ensure poll ends with question mark
    if (!formatted.endsWith('?')) {
      formatted += '?'
    }
  }
  
  return formatted
}

/**
 * Apply an edit instruction to existing content
 */
function applyEdit(existingContent: string, editMessage: string, type: DraftType): string {
  const lower = editMessage.toLowerCase()
  
  // Check for replacement patterns
  // "no it should say X" or "make it say X" or "change it to X"
  const replacementPatterns = [
    /\b(no[,.]?\s*)?(it should|make it|change it to|should be|should say)\s+["']?(.+?)["']?$/i,
    /\b(actually|instead)\s+["']?(.+?)["']?$/i,
    /^["'](.+)["']$/  // Just quoted text = full replacement
  ]
  
  for (const pattern of replacementPatterns) {
    const match = editMessage.match(pattern)
    if (match) {
      // Get the last capture group (the actual content)
      const newContent = match[match.length - 1]?.trim()
      if (newContent && newContent.length > 3) {
        return formatContent(newContent, type)
      }
    }
  }
  
  // Check for additive patterns
  // "add X" or "also mention X" or "include X"
  const additivePatterns = [
    /\b(add|also|include|mention|append)\s+["']?(.+?)["']?$/i,
    /\bsay it'?s?\s+(.+)/i  // "say it's at 9pm"
  ]
  
  for (const pattern of additivePatterns) {
    const match = editMessage.match(pattern)
    if (match) {
      const addition = match[match.length - 1]?.trim()
      if (addition && addition.length > 2) {
        // Append to existing content
        let combined = existingContent
        if (!combined.endsWith('.') && !combined.endsWith('!') && !combined.endsWith('?')) {
          combined += '.'
        }
        combined += ' ' + addition
        return formatContent(combined, type)
      }
    }
  }
  
  // Check for tone modifications
  const tonePatterns = [
    { pattern: /\b(make it|be)\s+(meaner|more aggressive|harsher|ruder)/i, tone: 'aggressive' },
    { pattern: /\b(make it|be)\s+(nicer|friendlier|softer|kinder)/i, tone: 'friendly' },
    { pattern: /\b(make it|be)\s+(funnier|more fun|sillier)/i, tone: 'funny' },
    { pattern: /\b(make it|be)\s+(more serious|professional|formal)/i, tone: 'serious' },
    { pattern: /\b(make it|be)\s+(shorter|more concise|brief)/i, tone: 'short' },
    { pattern: /\b(make it|be)\s+(longer|more detailed)/i, tone: 'long' }
  ]
  
  for (const { pattern, tone } of tonePatterns) {
    if (pattern.test(lower)) {
      return applyToneModification(existingContent, tone, type)
    }
  }
  
  // If no pattern matched, treat as full replacement
  return formatContent(editMessage, type)
}

/**
 * Apply tone modification to content
 */
function applyToneModification(content: string, tone: string, type: DraftType): string {
  // Simple tone modifications (in production, could use LLM)
  switch (tone) {
    case 'aggressive':
      // Add urgency
      return content.replace(/please/gi, '').replace(/\.$/, '!').toUpperCase()
    
    case 'friendly':
      // Add softeners
      if (!content.toLowerCase().includes('please')) {
        return content + ' please!'
      }
      return content
    
    case 'funny':
      // Add emoji
      return content + ' 🔥'
    
    case 'serious':
      // Remove emoji and exclamation
      return removeEmoji(content).replace(/!+/g, '.')
    
    case 'short':
      // Truncate to first sentence
      const firstSentence = content.match(/^[^.!?]+[.!?]?/)?.[0]
      return firstSentence || content
    
    case 'long':
      // Can't really make it longer without context
      return content + ' (details to follow)'
    
    default:
      return content
  }
}


      const firstSentence = content.match(/^[^.!?]+[.!?]?/)?.[0]
      return firstSentence || content
    
    case 'long':
      // Can't really make it longer without context
      return content + ' (details to follow)'
    
    default:
      return content
  }
}


      const firstSentence = content.match(/^[^.!?]+[.!?]?/)?.[0]
      return firstSentence || content
    
    case 'long':
      // Can't really make it longer without context
      return content + ' (details to follow)'
    
    default:
      return content
  }
}


      const firstSentence = content.match(/^[^.!?]+[.!?]?/)?.[0]
      return firstSentence || content
    
    case 'long':
      // Can't really make it longer without context
      return content + ' (details to follow)'
    
    default:
      return content
  }
}


      const firstSentence = content.match(/^[^.!?]+[.!?]?/)?.[0]
      return firstSentence || content
    
    case 'long':
      // Can't really make it longer without context
      return content + ' (details to follow)'
    
    default:
      return content
  }
}

