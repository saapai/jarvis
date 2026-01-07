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

// ============================================
// LINK DETECTION (LLM-BASED)
// ============================================

/**
 * Use LLM to format poll question properly
 */
async function formatPollQuestion(rawQuestion: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return rawQuestion
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const systemPrompt = `You are formatting poll questions for an SMS bot.

Take the user's raw input and turn it into a clear, grammatically correct yes/no question.

Rules:
- Keep it concise (under 100 characters if possible)
- Make it a proper question (starts with "Are you", "Will you", "Can you", etc.)
- Fix grammar and punctuation
- Preserve key details (time, date, location)
- Don't add extra information not in the original

Examples:
Input: "if people are coming to active meeting at 8pm at ash's at 610 levering apt 201"
Output: "Are you coming to active meeting at 8pm at Ash's (610 Levering Apt 201)?"

Input: "who's going to the game tomorrow"
Output: "Are you going to the game tomorrow?"

Return ONLY the formatted question, nothing else.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Format this poll question: "${rawQuestion}"` }
      ],
      temperature: 0.2,
      max_tokens: 80
    })

    const formatted = response.choices[0].message.content?.trim() || rawQuestion
    return formatted
  } catch (error) {
    console.error('[PollFormat] LLM formatting failed:', error)
    return rawQuestion
  }
}

/**
 * Use LLM to detect if a poll should require an excuse for "No"
 */
async function detectMandatoryPoll(message: string): Promise<{
  isMandatory: boolean
  reasoning: string
}> {
  if (!process.env.OPENAI_API_KEY) {
    return { isMandatory: false, reasoning: 'No API key' }
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const systemPrompt = `You are analyzing whether a poll/event is mandatory or requires attendance.

Indicators that something is MANDATORY:
- Uses words like "mandatory", "required", "must attend"
- Active meetings, required meetings
- Chapter meetings, official events
- Penalties mentioned for not attending
- "Everyone needs to be there"

NOT mandatory:
- Optional events
- Social gatherings  
- Study sessions
- Open invites
- "If you're interested"

Respond with JSON: { "isMandatory": boolean, "reasoning": string }`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Is this poll about a mandatory event? "${message}"` }
      ],
      temperature: 0.1,
      max_tokens: 100,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      console.log(`[MandatoryDetection] isMandatory=${parsed.isMandatory}, reasoning=${parsed.reasoning}`)
      return {
        isMandatory: parsed.isMandatory || false,
        reasoning: parsed.reasoning || 'LLM analysis'
      }
    }
  } catch (error) {
    console.error('[MandatoryDetection] LLM failed:', error)
  }

  return { isMandatory: false, reasoning: 'Fallback' }
}

/**
 * Use LLM to detect and extract links from a message
 */
async function detectLinks(message: string): Promise<{
  hasLinks: boolean
  links: string[]
  needsLink: boolean
  reasoning: string
}> {
  if (!process.env.OPENAI_API_KEY) {
    return { hasLinks: false, links: [], needsLink: false, reasoning: 'No API key' }
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const systemPrompt = `You are analyzing messages to detect:
1. If the message contains any URLs/links
2. If the message SHOULD have a link but doesn't

Messages that typically need links:
- RSVP requests
- Sign-up forms
- Registration
- "Fill out this form"
- "Click here"
- "Check out"
- Survey requests
- External resources
- Documents to review

Extract all URLs and determine if more links are needed.

Respond with JSON only: { "hasLinks": boolean, "links": string[], "needsLink": boolean, "reasoning": string }`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this message: "${message}"` }
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      console.log(`[LinkDetection] hasLinks=${parsed.hasLinks}, needsLink=${parsed.needsLink}, links=${JSON.stringify(parsed.links)}`)
      return {
        hasLinks: parsed.hasLinks || false,
        links: parsed.links || [],
        needsLink: parsed.needsLink || false,
        reasoning: parsed.reasoning || 'LLM analysis'
      }
    }
  } catch (error) {
    console.error('[LinkDetection] LLM failed:', error)
  }

  return { hasLinks: false, links: [], needsLink: false, reasoning: 'Fallback' }
}

/**
 * Validate that a string is a proper URL
 */
async function validateLink(link: string): Promise<boolean> {
  try {
    const url = new URL(link)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export interface DraftActionInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
  classification: ClassificationResult
  recentMessages?: Array<{
    direction: 'inbound' | 'outbound'
    text: string
    createdAt: Date
    meta?: { action?: string; draftContent?: string } | null
  }>
}

/**
 * Handle draft write/edit action
 */
export async function handleDraftWrite(input: DraftActionInput): Promise<ActionResult> {
  const { phone, message, userName, classification, recentMessages } = input
  
  const draftType = classification.subtype || 'announcement'
  const existingDraft = await draftRepo.getActiveDraft(phone)
  
  console.log(`[DraftWrite] Type: ${draftType}, Existing draft: ${existingDraft ? 'yes' : 'no'}`)
  
  // Case 1: No existing draft - determine if we have content or need to ask
  if (!existingDraft) {
    const content = await resolveDraftContent({
      message,
      draftType,
      recentMessages
    })
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
    
    // We have content - format it properly
    let formattedContent = formatContent(content, draftType)
    
    // For POLLS: format as proper question using LLM
    if (draftType === 'poll') {
      formattedContent = await formatPollQuestion(formattedContent)
      console.log(`[DraftWrite] Formatted poll question: "${formattedContent}"`)
    }
    
    console.log(`[DraftWrite] Creating draft with content: "${formattedContent}"`)
    
    // For ANNOUNCEMENTS ONLY: check for links
    let linkAnalysis: { hasLinks: boolean; links: string[]; needsLink: boolean; reasoning: string }
    if (draftType === 'announcement') {
      linkAnalysis = await detectLinks(formattedContent)
      
      // If it needs a link but doesn't have one, mark as pending
      if (linkAnalysis.needsLink && !linkAnalysis.hasLinks) {
        console.log(`[DraftWrite] Announcement needs a link but doesn't have one - setting pendingLink`)
        await draftRepo.createDraft(phone, draftType, formattedContent, {
          type: draftType
        })
        
        const newDraft: Draft = {
          type: draftType,
          content: formattedContent,
          status: 'drafting',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          pendingLink: true
        }
        
        return {
          action: 'draft_write',
          response: applyPersonality({
            baseResponse: `got it, but this looks like it needs a link (RSVP, form, etc.). send me the link and i'll add it to the ${draftType}`,
            userMessage: message,
            userName
          }),
          newDraft
        }
      }
    } else {
      // Polls don't need link detection
      linkAnalysis = { hasLinks: false, links: [], needsLink: false, reasoning: 'Poll - skip link detection' }
    }
    
    // For polls, ask if it should be mandatory (requires excuse for "No")
    if (draftType === 'poll') {
      console.log(`[DraftWrite] Poll created, asking about mandatory status...`)
      
      // Save draft as "drafting" until mandatory status is confirmed
      await draftRepo.createDraft(phone, draftType, formattedContent, {
        type: draftType,
        requiresExcuse: false,  // Will be updated after confirmation
        pendingMandatory: true
      })
      
      const newDraft: Draft = {
        type: draftType,
        content: formattedContent,
        status: 'drafting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        links: linkAnalysis.links,
        requiresExcuse: false,
        pendingMandatory: true
      }
      
      return {
        action: 'draft_write',
        response: applyPersonality({
          baseResponse: `📝 here's the poll:\n\n"${formattedContent}"\n\nshould people need to give an excuse if they say no? (yes/no)`,
          userMessage: message,
          userName
        }),
        newDraft
      }
    }
    
    // For announcements, draft is ready immediately
    await draftRepo.createDraft(phone, draftType, formattedContent, {
      type: draftType,
      requiresExcuse: false
    })
    
    const newDraft: Draft = {
      type: draftType,
      content: formattedContent,
      status: 'ready',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      links: linkAnalysis.links,
      requiresExcuse: false
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
  
  // Case 2a: Existing poll draft waiting for mandatory confirmation
  if (existingDraft.pendingMandatory && existingDraft.type === 'poll') {
    console.log(`[DraftWrite] Poll waiting for mandatory confirmation: "${message}"`)
    
    // Parse yes/no response
    const lowerMsg = message.toLowerCase().trim()
    const requiresExcuse = /\b(yes|y|yep|yeah|mandatory|required)\b/i.test(lowerMsg)
    
    console.log(`[DraftWrite] Mandatory confirmation: requiresExcuse=${requiresExcuse}`)
    
    // Update draft with mandatory status and mark as ready
    // Merge with existing structured payload to preserve other fields
    const currentPayload = existingDraft.type === 'poll' ? {
      type: 'poll' as const,
      requiresExcuse: existingDraft.requiresExcuse || false,
      links: existingDraft.links || [],
      pendingMandatory: false
    } : {
      type: 'poll' as const,
      requiresExcuse: false,
      links: [],
      pendingMandatory: false
    }
    
    await draftRepo.updateDraftByPhone(phone, { 
      draftText: existingDraft.content,
      structuredPayload: {
        ...currentPayload,
        requiresExcuse,
        pendingMandatory: false
      }
    })
    
    const updatedDraft: Draft = {
      ...existingDraft,
      status: 'ready',
      requiresExcuse,
      pendingMandatory: false,
      updatedAt: Date.now()
    }
    
    const excuseNote = requiresExcuse ? ' (mandatory - excuses required for "no")' : ''
    
    return {
      action: 'draft_write',
      response: applyPersonality({
        baseResponse: `got it! here's the poll:\n\n"${existingDraft.content}"${excuseNote}\n\nsay "send" when ready`,
        userMessage: message,
        userName
      }),
      newDraft: updatedDraft
    }
  }
  
  // Case 2b: Existing draft waiting for a link
  if (existingDraft.pendingLink) {
    const linkAnalysis = await detectLinks(message)
    
    if (linkAnalysis.hasLinks && linkAnalysis.links.length > 0) {
      // Add link to the draft content
      const updatedContent = `${existingDraft.content}\n\n${linkAnalysis.links.join('\n')}`
      await draftRepo.updateDraftByPhone(phone, { draftText: updatedContent })
      
      const updatedDraft: Draft = {
        ...existingDraft,
        content: updatedContent,
        status: 'ready',
        updatedAt: Date.now(),
        pendingLink: false,
        links: linkAnalysis.links
      }
      
      return {
        action: 'draft_write',
        response: applyPersonality({
          baseResponse: `perfect! here's the ${existingDraft.type} with the link:\n\n"${updatedContent}"\n\nsay "send" when ready`,
          userMessage: message,
          userName
        }),
        newDraft: updatedDraft
      }
    } else {
      // Didn't send a link - prompt again
      return {
        action: 'draft_write',
        response: applyPersonality({
          baseResponse: "didn't catch a link there. send me the URL for this " + existingDraft.type,
          userMessage: message,
          userName
        })
      }
    }
  }
  
  // Case 2c: Existing draft in 'drafting' state (waiting for content)
  if (existingDraft.status === 'drafting' && !existingDraft.content) {
    const content = formatContent(
      await resolveDraftContent({
        message,
        draftType: existingDraft.type,
        previousContent: existingDraft.content || undefined,
        recentMessages
      }),
      existingDraft.type
    )
    
    // Check for links in the new content
    const linkAnalysis = await detectLinks(content)
    
    if (linkAnalysis.needsLink && !linkAnalysis.hasLinks) {
      // Update draft but mark as pending link
      await draftRepo.updateDraftByPhone(phone, { draftText: content })
      
      const updatedDraft: Draft = {
        ...existingDraft,
        content,
        status: 'drafting',
        updatedAt: Date.now(),
        pendingLink: true
      }
      
      return {
        action: 'draft_write',
        response: applyPersonality({
          baseResponse: `got it, but this looks like it needs a link. send me the link and i'll add it`,
          userMessage: message,
          userName
        }),
        newDraft: updatedDraft
      }
    }
    
    // Update draft in DB
    await draftRepo.updateDraftByPhone(phone, { draftText: content })
    
    const updatedDraft: Draft = {
      ...existingDraft,
      content,
      status: 'ready',
      updatedAt: Date.now(),
      links: linkAnalysis.links
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
  
  // Case 2d: Existing draft in 'ready' state - user is editing
  if (existingDraft.status === 'ready') {
    // Use LLM-based resolution with full context
    const editedContent = await resolveDraftContent({
      message,
      draftType: existingDraft.type,
      previousContent: existingDraft.content,
      recentMessages
    })
    
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
    // Ensure poll ends with question mark (but avoid double ??)
    if (!formatted.endsWith('?')) {
      formatted += '?'
    }
    // Remove double question marks
    formatted = formatted.replace(/\?\?+/g, '?')
  }
  
  return formatted
}

// ============================================
// LLM-ASSISTED CONTENT RESOLUTION
// ============================================

interface ResolveDraftContentParams {
  message: string
  draftType: DraftType
  previousContent?: string
  recentMessages?: Array<{
    direction: 'inbound' | 'outbound'
    text: string
    createdAt: Date
    meta?: { action?: string; draftContent?: string } | null
  }>
}

/**
 * Resolve the intended draft content using recent context and LLM.
 * Falls back to pattern-based extraction if LLM is unavailable.
 */
async function resolveDraftContent(params: ResolveDraftContentParams): Promise<string> {
  const { message, draftType, previousContent, recentMessages } = params
  
  // Fallback to simple extractor if no API key
  if (!process.env.OPENAI_API_KEY) {
    return extractContent(message, draftType)
  }
  
  // Build conversation context with both user and bot messages
  const history = (recentMessages || [])
    .slice(-6) // Last 6 messages (3 exchanges)
    .map(m => ({
      role: m.direction === 'inbound' ? 'User' : 'Bot',
      text: m.text
    }))
  
  const systemPrompt = `You are extracting the exact message content that should be sent as a ${draftType}.

CRITICAL RULES:
1. VERBATIM CONTENT: When the user says "send out [type] saying X" or "send out [type] that X", X is EXACTLY what to send. Do NOT paraphrase.
2. FOLLOW-UPS: Words like "wait", "no", "actually", "instead" indicate the user is EDITING. Extract only the NEW content they want.
3. CONTEXT AWARENESS: Use conversation history to understand what they're referring to. If they say "say it's next week", "it's next week" is the content.
4. NO META LANGUAGE: Never include phrases like "Send out an announcement" in the output. Only return the actual message content.
5. EDITING SIGNALS:
   - "wait say X" → content is "X"
   - "no just say X" → content is "X"
   - "actually X" → content is "X"
   - "make it say X" → content is "X"
   - "change it to X" → content is "X"

Examples:
- "send out an announcement saying soccer is tomorrow" → "soccer is tomorrow"
- "wait say it's next week" → "it's next week"
- "no just say jarvis is king" → "jarvis is king"
- "send out a poll asking if jarvis is lit" → "is jarvis lit"

Return ONLY the exact text to send. No quotes, no explanations.`
  
  const historyText = history.length > 0 
    ? history.map(h => `${h.role}: ${h.text}`).join('\n')
    : '(no history)'
  
  const userPrompt = `Recent conversation:
${historyText}

Current user message: "${message}"
${previousContent ? `Previous draft: "${previousContent}"` : ''}

Extract the exact text that should be sent:`
  
  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1, // Lower temperature for more literal extraction
      max_tokens: 120
    })
    
    const content = completion.choices[0].message.content?.trim() || ''
    console.log(`[DraftWrite] LLM extracted: "${content}"`)
    
    if (!content) return extractContent(message, draftType)
    
    return formatContent(content, draftType)
  } catch (error) {
    console.error('[DraftWrite] LLM extraction failed, falling back:', error)
    return extractContent(message, draftType)
  }
}

