import { NextRequest, NextResponse } from 'next/server'
import { validateTwilioSignature, toTwiml, sendSms } from '@/lib/twilio'
import { normalizePhone, toE164 } from '@/lib/db'
import { classifyIntent } from '@/lib/planner/classifier'
import { applyPersonalityAsync } from '@/lib/planner/personality'
import { buildWeightedHistoryFromMessages } from '@/lib/planner/history'
import * as actions from '@/lib/planner/actions'
import * as messageRepo from '@/lib/repositories/messageRepository'
import * as draftRepo from '@/lib/repositories/draftRepository'
import * as convRepo from '@/lib/repositories/conversationRepository'
import * as pollRepo from '@/lib/repositories/pollRepository'
import * as memberRepo from '@/lib/repositories/memberRepository'
import type { ActionResult } from '@/lib/planner/types'
import { routeContentSearch } from '@/text-explorer/router'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const body = formData.get('Body')?.toString() || ''
    const from = formData.get('From')?.toString() || ''
    
    // Validate signature in production
    if (process.env.NODE_ENV === 'production') {
      const signature = request.headers.get('x-twilio-signature') || ''
      const url = `${process.env.APP_URL}/api/twilio/sms`
      const params: Record<string, string> = {}
      formData.forEach((value, key) => { params[key] = value.toString() })
      
      if (!await validateTwilioSignature(signature, url, params)) {
        return new NextResponse('Forbidden', { status: 403 })
      }
    }
    
    const phone = normalizePhone(from)
    const message = body.trim()
    
    console.log(`[SMS] ${phone}: ${message}`)
    
    const response = await handleMessage(phone, message)
    
    return new NextResponse(toTwiml([response]), {
      headers: { 'Content-Type': 'text/xml' }
    })
    
  } catch (error) {
    console.error('SMS error:', error)
    return new NextResponse(
      toTwiml(['oops, something went wrong. try again?']),
      { headers: { 'Content-Type': 'text/xml' } }
    )
  }
}

async function handleMessage(phone: string, message: string): Promise<string> {
  // 1. Log inbound message
  await messageRepo.logMessage(phone, 'inbound', message, null)
  
  // 2. Get or create user
  let user = await memberRepo.getMember(phone)
  if (!user) {
    user = await memberRepo.createMember(phone)
    if (!user) {
      return "hey! couldn't create your account. try again?"
    }
  }
  
  // 3. Handle system commands (STOP, START, HELP)
  const systemResponse = handleSystemCommand(user, message)
  if (systemResponse) {
    await messageRepo.logMessage(phone, 'outbound', systemResponse, { action: 'system_command' })
    return systemResponse
  }
  
  // 4. Handle onboarding (name collection)
  if (user.needs_name) {
    const onboardingResponse = await handleOnboarding(phone, message, user)
    await messageRepo.logMessage(phone, 'outbound', onboardingResponse, { action: 'onboarding' })
    return onboardingResponse
  }
  
  // 5. Load conversation context
  const recentMessages = await messageRepo.getRecentMessages(phone, 10)
  const history = buildWeightedHistoryFromMessages(recentMessages)
  const convState = await convRepo.getConversationState(phone)
  const activeDraft = await draftRepo.getActiveDraft(phone)
  const activePoll = await pollRepo.getActivePoll()
  
  // 6. Classify intent using LLM
  const context = {
    currentMessage: message,
    history,
    activeDraft,
    isAdmin: memberRepo.isAdmin(phone),
    userName: user.name,
    hasActivePoll: Boolean(activePoll)
  }
  
  const classification = await classifyIntent(context)
  console.log(`[Classification] ${classification.action} (${classification.confidence.toFixed(2)}) - ${classification.reasoning}`)
  console.log(`[ActionRouter] Routing to ${classification.action} handler...`)
  
  // 7. Route to appropriate handler
  let actionResult: ActionResult
  
  switch (classification.action) {
    case 'draft_write':
      console.log(`[DraftWrite] Creating/editing draft...`)
      actionResult = await actions.handleDraftWrite({
        phone,
        message,
        userName: user.name,
        isAdmin: memberRepo.isAdmin(phone),
        classification,
        recentMessages
      })
      console.log(`[DraftWrite] Result: ${actionResult.response.substring(0, 50)}...`)
      if (actionResult.newDraft) {
        console.log(`[DraftWrite] Draft state: ${actionResult.newDraft.status}, content: "${actionResult.newDraft.content}"`)
      }
      break
    
    case 'draft_send':
      console.log(`[DraftSend] Attempting to send draft...`)
      if (activeDraft) {
        console.log(`[DraftSend] Active draft: type=${activeDraft.type}, content="${activeDraft.content}"`)
      }
      actionResult = await actions.handleDraftSend({
        phone,
        message,
        userName: user.name,
        isAdmin: memberRepo.isAdmin(phone),
        sendAnnouncement: sendAnnouncementToAll,
        sendPoll: sendPollToAll
      })
      console.log(`[DraftSend] Result: ${actionResult.response.substring(0, 50)}...`)
      break
    
    case 'content_query':
      console.log(`[ContentQuery] Querying content for: "${message}"`)
      actionResult = await actions.handleContentQuery({
        phone,
        message,
        userName: user.name,
        searchContent: searchFactsDatabase,
        recentMessages,
        searchPastActions: searchPastAnnouncements
      })
      console.log(`[ContentQuery] Result: ${actionResult.response.substring(0, 50)}...`)
      break

    case 'poll_response':
      console.log(`[PollResponse] Recording poll response...`)
      actionResult = await actions.handlePollResponse({
        phone,
        message,
        userName: user.name
      })
      console.log(`[PollResponse] Result: ${actionResult.response.substring(0, 50)}...`)
      break
    
    case 'capability_query':
      console.log(`[CapabilityQuery] Explaining capabilities...`)
      actionResult = await actions.handleCapabilityQuery({
        phone,
        message,
        userName: user.name,
        isAdmin: memberRepo.isAdmin(phone)
      })
      console.log(`[CapabilityQuery] Result: ${actionResult.response.substring(0, 50)}...`)
      break
    
    case 'knowledge_upload':
      console.log(`[KnowledgeUpload] Admin uploading knowledge...`)
      actionResult = await actions.handleKnowledgeUpload({
        phone,
        message,
        userName: user.name,
        isAdmin: memberRepo.isAdmin(phone)
      })
      console.log(`[KnowledgeUpload] Result: ${actionResult.response.substring(0, 50)}...`)
      break
    
    case 'event_update':
      console.log(`[EventUpdate] Admin updating event...`)
      // Check if there's a pending confirmation from the last message
      const lastMessage = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null
      const pendingConfirmation = lastMessage?.meta?.pendingConfirmation || undefined
      
      actionResult = await actions.handleEventUpdate({
        phone,
        message,
        userName: user.name,
        isAdmin: memberRepo.isAdmin(phone),
        pendingConfirmation
      })
      console.log(`[EventUpdate] Result: ${actionResult.response.substring(0, 50)}...`)
      break
    
    case 'chat':
    default:
      console.log(`[Chat] Handling as casual conversation...`)
      actionResult = await actions.handleChat({
        phone,
        message,
      userName: user.name,
      isAdmin: memberRepo.isAdmin(phone)
      })
      console.log(`[Chat] Result: ${actionResult.response.substring(0, 50)}...`)
      break
  }
  
  console.log(`[ActionRouter] Action complete, applying personality...`)
  
  // 8. Apply personality to response (using LLM for context-aware personality)
  const finalResponse = await applyPersonalityAsync({
    baseResponse: actionResult.response,
    userMessage: message,
    userName: user.name,
    useLLM: true // LLM-based personality for better context understanding
  })
  
  // 9. Log outbound message with draft content if applicable
  const metadata: any = {
    action: classification.action,
    confidence: classification.confidence
  }
  
  // Store draft content for later retrieval
  if (classification.action === 'draft_send' && activeDraft?.content) {
    metadata.draftContent = activeDraft.content
  } else if (classification.action === 'draft_write' && actionResult.newDraft?.content) {
    metadata.draftContent = actionResult.newDraft.content
  }
  
  // Store pending confirmation for event updates
  if (actionResult.pendingConfirmation) {
    metadata.pendingConfirmation = actionResult.pendingConfirmation
  }
  
  await messageRepo.logMessage(phone, 'outbound', finalResponse, metadata)
  
  // 10. Update conversation state if needed (handled by action handlers)
  
  return finalResponse
}

// ============================================
// SYSTEM COMMANDS
// ============================================

function handleSystemCommand(user: any, message: string): string | null {
  const lower = message.toLowerCase().trim()
  
  // STOP command
  if (lower === 'stop') {
    memberRepo.setOptedOut(user.id, true)
    return "you've been unsubscribed. text START to rejoin."
  }
  
  // START command
  if (lower === 'start') {
    memberRepo.setOptedOut(user.id, false)
    return "welcome back! you're subscribed."
  }
  
  // HELP command
  if (lower === 'help') {
    if (memberRepo.isAdmin(user.phone)) {
      return `🤖 admin commands:
📢 "announce [message]" - send to everyone
📊 "poll [question]" - ask everyone
💬 ask me questions about the org
text STOP to unsubscribe`
    }
    return `🤖 jarvis help:
• reply to polls with yes/no/maybe
• add notes like "yes but running late"
• ask questions about events and schedules
• text STOP to unsubscribe`
  }
  
  return null
}

// ============================================
// ONBOARDING
// ============================================

/**
 * Extract name from user message
 * Removes common prefixes like "I'm", "my name is", etc.
 */
function extractName(message: string): string | null {
  const text = message.trim()
  
  // Check if message is too long or too short
  if (text.length > 50 || text.length < 2) return null
  
  // Check if it starts with common non-name patterns
  if (/^(yes|no|maybe|\d+|stop|help|start|announce|poll)$/i.test(text.toLowerCase())) {
    return null
  }
  
  // Remove common prefixes
  const patterns = [
    /^i'?m\s+/i,              // "I'm" or "Im"
    /^my\s+name\s+is\s+/i,    // "my name is"
    /^this\s+is\s+/i,         // "this is"
    /^call\s+me\s+/i,         // "call me"
    /^it'?s\s+/i,             // "it's" or "its"
    /^i\s+am\s+/i,            // "i am"
    /^name\s+is\s+/i,         // "name is"
    /^name:\s*/i,             // "name:"
    /^hi,?\s+i'?m\s+/i,       // "hi I'm" or "hi im"
    /^hello,?\s+i'?m\s+/i,    // "hello I'm"
    /^hey,?\s+i'?m\s+/i,      // "hey I'm"
  ]
  
  let extracted = text
  for (const pattern of patterns) {
    extracted = extracted.replace(pattern, '')
  }
  
  // Clean up the extracted name
  extracted = extracted
    .replace(/[!.?,;]+$/, '')  // Remove trailing punctuation
    .trim()
  
  // Validate the extracted name
  if (extracted.length < 2 || extracted.length > 50) return null
  
  // Check if it still looks like a command or common phrase
  if (/^(hi|hello|hey|yes|no|maybe|thanks|ok|okay)$/i.test(extracted)) {
    return null
  }
  
  // Capitalize first letter of each word
  return extracted
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

async function handleOnboarding(phone: string, message: string, user: any): Promise<string> {
  const extractedName = extractName(message)
  
  if (extractedName) {
    await memberRepo.updateMemberName(user.id, extractedName)
    
    if (memberRepo.isAdmin(phone)) {
      return `hey ${extractedName}! 👋 you're set up as an admin.

📢 "announce [message]" - send to all
📊 "poll [question]" - ask everyone
💬 ask me anything about the org`
    }
    return `hey ${extractedName}! 👋 you're all set. you'll get announcements and polls from the team.`
  }
  
  // If name extraction failed, ask again with a hint
  return "hey! i'm jarvis, powered by enclave. what's your name?"
}

// ============================================
// ANNOUNCEMENT SENDING
// ============================================

async function sendAnnouncementToAll(content: string, senderPhone: string): Promise<number> {
  const users = await memberRepo.getOptedInMembers()
  let sent = 0
  
  console.log(`[Announce] Sending to ${users.length} users`)
  
  for (const user of users) {
    const userPhoneNormalized = user.phone ? normalizePhone(user.phone) : ''
    
    // Skip invalid phones only
    if (!userPhoneNormalized || userPhoneNormalized.length < 10) continue
    
    const result = await sendSms(toE164(userPhoneNormalized), content)
    if (result.ok) {
      sent++
    } else {
      console.log(`[Announce] Failed to send to ${userPhoneNormalized}: ${result.error}`)
    }
  }
  
  console.log(`[Announce] Complete: sent=${sent}`)
  return sent
}

// ============================================
// POLL SENDING
// ============================================

async function sendPollToAll(question: string, senderPhone: string, requiresExcuse: boolean = false): Promise<number> {
  // Create poll in database
  const poll = await pollRepo.createPoll(question, senderPhone, requiresExcuse)
  
  const users = await memberRepo.getOptedInMembers()
  let sent = 0
  
  console.log(`[Poll] Sending poll "${question}" to ${users.length} users (requiresExcuse: ${requiresExcuse})`)
  
  // Use fixed Airtable field names (Airtable API doesn't support creating fields)
  // These fields must exist in Airtable: POLL_LATEST_Q, POLL_LATEST_R, POLL_LATEST_N
  const pollFields = {
    questionField: 'POLL_LATEST_Q',
    responseField: 'POLL_LATEST_R',
    notesField: 'POLL_LATEST_N'
  }
  console.log(`[Poll] Updating Airtable poll fields for: "${question}"`)
  
  const excuseNote = requiresExcuse ? ' (if no explain why)' : ''
  const pollMessage = `📊 ${question}\n\nreply yes/no/maybe${excuseNote}`
  
  for (const user of users) {
    const userPhoneNormalized = user.phone ? normalizePhone(user.phone) : ''
    
    // Skip invalid phones only
    if (!userPhoneNormalized || userPhoneNormalized.length < 10) continue
    
    // Initialize ALL poll fields in Airtable (creates the columns if needed)
    try {
      await memberRepo.updateMember(user.id, {
        [pollFields.questionField]: question,
        [pollFields.responseField]: '',  // Empty initially
        [pollFields.notesField]: ''      // Empty initially
      })
    } catch (airtableError) {
      console.error(`[Poll] Failed to initialize Airtable field for user ${user.id}:`, airtableError)
      // Continue anyway - response sync will handle it later
    }
    
    const result = await sendSms(toE164(userPhoneNormalized), pollMessage)
    if (result.ok) {
      sent++
    }
  }
  
  console.log(`[Poll] Complete: sent=${sent}`)
  return sent
}

// ============================================
// KNOWLEDGE SEARCH
// ============================================

interface ContentResult {
  title: string
  body: string
  score: number
}

async function searchFactsDatabase(query: string): Promise<ContentResult[]> {
  return routeContentSearch(query)
}

async function searchPastAnnouncements(): Promise<Array<{
  type: 'announcement' | 'poll'
  content: string
  sentAt: Date
  sentBy: string
}>> {
  return messageRepo.getPastActions()
}

// ============================================
// DIAGNOSTIC ENDPOINT
// ============================================

export async function GET(request: NextRequest) {
  try {
    const users = await memberRepo.getOptedInMembers()
    const activePoll = await pollRepo.getActivePoll()
    
    return NextResponse.json({
      status: 'running',
      version: '2.0-planner',
      members: users.length,
      activePoll: activePoll ? {
        question: activePoll.questionText,
        createdAt: activePoll.createdAt
      } : null
    })
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      error: String(error)
    }, { status: 500 })
  }
}
