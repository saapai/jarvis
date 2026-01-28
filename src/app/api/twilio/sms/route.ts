import { NextRequest, NextResponse } from 'next/server'
import { validateTwilioSignature, toTwiml, sendSms } from '@/lib/twilio'
import { normalizePhone, toE164, ensurePollFieldsExist } from '@/lib/db'
import { classifyIntent } from '@/lib/planner/classifier'
import { applyPersonalityAsync } from '@/lib/planner/personality'
import { buildWeightedHistoryFromMessages } from '@/lib/planner/history'
import * as actions from '@/lib/planner/actions'
import * as messageRepo from '@/lib/repositories/messageRepository'
import * as draftRepo from '@/lib/repositories/draftRepository'
import * as convRepo from '@/lib/repositories/conversationRepository'
import * as pollRepo from '@/lib/repositories/pollRepository'
import * as memberRepo from '@/lib/repositories/memberRepository'
import * as eventRepo from '@/lib/repositories/eventRepository'
import * as spaceContext from '@/lib/spaceContext'
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
  // 0. Auto-bypass for test phone number - route to Amia's space
  const TEST_PHONE = '3853687238'
  const normalizedTestPhone = normalizePhone(TEST_PHONE)
  const normalizedPhone = normalizePhone(phone)
  
  let activeSpaceId: string | null = null
  
  if (normalizedPhone === normalizedTestPhone) {
    // Auto-route test phone to Amia's space
    const prisma = await (await import('@/lib/prisma')).getPrisma()
    const amiaSpace = await prisma.space.findUnique({
      where: { slug: 'amias-space' }
    })
    if (amiaSpace) {
      activeSpaceId = amiaSpace.id
      await spaceContext.setActiveSpaceId(phone, amiaSpace.id)
      console.log(`[AutoBypass] Routing test phone ${phone} to Amia's space (${amiaSpace.id})`)
    }
  } else {
    // 0. Check for space commands (JOIN, SPACES)
    const spaceCommandResponse = await handleSpaceCommand(phone, message)
    if (spaceCommandResponse) {
      await messageRepo.logMessage(phone, 'outbound', spaceCommandResponse, { action: 'space_command' })
      return spaceCommandResponse
    }

    // 1. Get active space for this user
    activeSpaceId = await spaceContext.getActiveSpaceId(phone)
  }

  // 1b. Log inbound message (with space context)
  await messageRepo.logMessage(phone, 'inbound', message, null, activeSpaceId)

  // 2. Get member from active space, or create via legacy Airtable
  let user = null
  let isSpaceMember = false

  if (activeSpaceId) {
    // Multi-space mode: get member from space
    const spaceMember = await spaceContext.getSpaceMember(activeSpaceId, phone)
    if (spaceMember) {
      isSpaceMember = true
      user = {
        id: spaceMember.userId,
        phone: spaceMember.phoneNumber,
        name: spaceMember.name,
        needs_name: !spaceMember.name,
        opted_out: spaceMember.optedOut,
        pending_poll: null,
        last_response: null,
        last_notes: null
      }
    }
  }

  // Fallback to legacy Airtable-based member lookup
  if (!user) {
    user = await memberRepo.getMember(phone)
    if (!user) {
      user = await memberRepo.createMember(phone)
      if (!user) {
        // Check if user has any spaces they could join
        const userSpaces = await spaceContext.getUserSpacesByPhone(phone)
        if (userSpaces.length === 0) {
          // For test phone, auto-create in Amia's space if it exists
          if (normalizedPhone === normalizedTestPhone && activeSpaceId) {
            const prisma = await (await import('@/lib/prisma')).getPrisma()
            const testUser = await prisma.user.create({
              data: { phoneNumber: normalizedPhone }
            })
            await prisma.spaceMember.create({
              data: {
                spaceId: activeSpaceId,
                userId: testUser.id,
                role: 'admin',
                name: null
              }
            })
            user = {
              id: testUser.id,
              phone: normalizedPhone,
              name: null,
              needs_name: true,
              opted_out: false,
              pending_poll: null,
              last_response: null,
              last_notes: null
            }
            console.log(`[AutoBypass] Auto-created test user in Amia's space`)
          } else {
            return "hey! text JOIN <code> to join a space. ask your admin for the code."
          }
        } else {
          return "hey! couldn't create your account. try again?"
        }
      }
    }
  }

  // 3. Handle system commands (STOP, START, HELP)
  const systemResponse = await handleSystemCommand(user, message, activeSpaceId)
  if (systemResponse) {
    await messageRepo.logMessage(phone, 'outbound', systemResponse, { action: 'system_command' }, activeSpaceId)
    return systemResponse
  }

  // 4. Handle onboarding (name collection)
  if (user.needs_name) {
    const onboardingResponse = await handleOnboarding(phone, message, user, activeSpaceId)
    await messageRepo.logMessage(phone, 'outbound', onboardingResponse, { action: 'onboarding' }, activeSpaceId)
    return onboardingResponse
  }

  // 5. Load conversation context (space-scoped)
  const recentMessages = await messageRepo.getRecentMessages(phone, 10, activeSpaceId)
  const history = buildWeightedHistoryFromMessages(recentMessages)
  const convState = await convRepo.getConversationState(phone, activeSpaceId)
  const activeDraft = await draftRepo.getActiveDraft(phone, activeSpaceId)
  const activePoll = await pollRepo.getActivePoll(activeSpaceId)
  
  // Check if user has pending excuse request (No response without notes for mandatory poll)
  let pendingExcuseRequest = false
  if (activePoll && activePoll.requiresReasonForNo) {
    const existingResponse = await pollRepo.getPollResponse(activePoll.id, phone)
    if (existingResponse && existingResponse.response === 'No' && !existingResponse.notes) {
      pendingExcuseRequest = true
      console.log(`[Classification] User has pending excuse request for poll ${activePoll.id}`)
    }
  }
  
  // 6. Classify intent using LLM
  // Check admin status (space-scoped or global)
  const isAdmin = activeSpaceId
    ? await spaceContext.isSpaceAdminByPhone(activeSpaceId, phone)
    : memberRepo.isAdmin(phone)

  const context = {
    currentMessage: message,
    history,
    activeDraft,
    isAdmin,
    userName: user.name,
    hasActivePoll: Boolean(activePoll),
    pendingExcuseRequest
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
        isAdmin,
        classification,
        recentMessages,
        spaceId: activeSpaceId
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
        isAdmin,
        sendAnnouncement: (content: string, sender: string) => sendAnnouncementToAll(content, sender, activeSpaceId),
        sendPoll: (question: string, sender: string, requiresExcuse?: boolean) => sendPollToAll(question, sender, requiresExcuse ?? false, activeSpaceId),
        spaceId: activeSpaceId
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
        searchEvents: () => searchEventsDatabase(activeSpaceId),
        recentMessages,
        searchPastActions: () => searchPastAnnouncements(activeSpaceId)
      })
      console.log(`[ContentQuery] Result: ${actionResult.response.substring(0, 50)}...`)
      break

    case 'poll_response':
      console.log(`[PollResponse] Recording poll response...`)
      actionResult = await actions.handlePollResponse({
        phone,
        message,
        userName: user.name,
        spaceId: activeSpaceId
      })
      console.log(`[PollResponse] Result: ${actionResult.response.substring(0, 50)}...`)
      break

    case 'capability_query':
      console.log(`[CapabilityQuery] Explaining capabilities...`)
      actionResult = await actions.handleCapabilityQuery({
        phone,
        message,
        userName: user.name,
        isAdmin
      })
      console.log(`[CapabilityQuery] Result: ${actionResult.response.substring(0, 50)}...`)
      break

    case 'knowledge_upload':
      console.log(`[KnowledgeUpload] Admin uploading knowledge...`)
      actionResult = await actions.handleKnowledgeUpload({
        phone,
        message,
        userName: user.name,
        isAdmin
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
        isAdmin,
        pendingConfirmation,
        spaceId: activeSpaceId
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
        isAdmin
      })
      console.log(`[Chat] Result: ${actionResult.response.substring(0, 50)}...`)
      break
  }
  
  console.log(`[ActionRouter] Action complete, applying personality...`)
  
  // 8. Apply personality to response (using LLM for context-aware personality)
  // Convert history to string format for personality engine
  const historyString = history.length > 0
    ? history.map(turn => `${turn.role === 'user' ? 'User' : 'Jarvis'}: ${turn.content}`).join('\n')
    : undefined
  
  const finalResponse = await applyPersonalityAsync({
    baseResponse: actionResult.response,
    userMessage: message,
    userName: user.name,
    useLLM: true, // LLM-based personality for better context understanding
    conversationHistory: historyString // Pass conversation history for context
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
  
  await messageRepo.logMessage(phone, 'outbound', finalResponse, metadata, activeSpaceId)

  // 10. Update conversation state if needed (handled by action handlers)

  return finalResponse
}

// ============================================
// SPACE COMMANDS (JOIN, SPACES)
// ============================================

async function handleSpaceCommand(phone: string, message: string): Promise<string | null> {
  const lower = message.toLowerCase().trim()

  // JOIN command: JOIN <code>
  const joinMatch = message.trim().match(/^join\s+(\w+)$/i)
  if (joinMatch) {
    const code = joinMatch[1].toUpperCase()
    const space = await spaceContext.findSpaceByJoinCode(code)

    if (!space) {
      return `space "${code}" not found. check the code and try again.`
    }

    const result = await spaceContext.addUserToSpace(phone, space.id)
    await spaceContext.setActiveSpaceId(phone, space.id)

    if (result.existing) {
      return `switched to ${space.name}! text HELP to see commands.`
    }
    return `welcome to ${space.name}! you're now connected. text HELP to see commands.`
  }

  // SPACES command: list user's spaces
  if (lower === 'spaces') {
    const spaces = await spaceContext.getUserSpacesByPhone(phone)

    if (spaces.length === 0) {
      return `you're not in any spaces yet. text JOIN <code> to join one.`
    }

    const activeSpaceId = await spaceContext.getActiveSpaceId(phone)
    const spaceList = spaces.map(s => {
      const active = s.id === activeSpaceId ? ' (active)' : ''
      return `• ${s.name}${active} - JOIN ${s.joinCode}`
    }).join('\n')

    return `your spaces:\n${spaceList}\n\ntext JOIN <code> to switch`
  }

  return null
}

// ============================================
// SYSTEM COMMANDS
// ============================================

async function handleSystemCommand(user: any, message: string, activeSpaceId?: string | null): Promise<string | null> {
  const lower = message.toLowerCase().trim()

  // STOP command
  if (lower === 'stop') {
    if (activeSpaceId) {
      await spaceContext.setMemberOptedOut(activeSpaceId, user.phone, true)
    } else {
      memberRepo.setOptedOut(user.id, true)
    }
    return "you've been unsubscribed. text START to rejoin."
  }

  // START command
  if (lower === 'start') {
    if (activeSpaceId) {
      await spaceContext.setMemberOptedOut(activeSpaceId, user.phone, false)
    } else {
      memberRepo.setOptedOut(user.id, false)
    }
    return "welcome back! you're subscribed."
  }

  // HELP command
  if (lower === 'help') {
    const isAdmin = activeSpaceId
      ? await spaceContext.isSpaceAdminByPhone(activeSpaceId, user.phone)
      : memberRepo.isAdmin(user.phone)

    if (isAdmin) {
      return `🤖 admin commands:
📢 "announce [message]" - send to everyone
📊 "poll [question]" - ask everyone
💬 ask me questions about the org
text SPACES to see your spaces
text STOP to unsubscribe`
    }
    return `🤖 jarvis help:
• reply to polls with yes/no/maybe
• add notes like "yes but running late"
• ask questions about events and schedules
• text SPACES to see your spaces
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

async function handleOnboarding(phone: string, message: string, user: any, activeSpaceId?: string | null): Promise<string> {
  const extractedName = extractName(message)

  if (extractedName) {
    await memberRepo.updateMemberName(user.id, extractedName)

    // Also update space member name if in a space
    if (activeSpaceId) {
      const prisma = await (await import('@/lib/prisma')).getPrisma()
      await prisma.spaceMember.updateMany({
        where: {
          spaceId: activeSpaceId,
          user: { phoneNumber: normalizePhone(phone) }
        },
        data: { name: extractedName }
      })
    }

    const isAdmin = activeSpaceId
      ? await spaceContext.isSpaceAdminByPhone(activeSpaceId, phone)
      : memberRepo.isAdmin(phone)

    if (isAdmin) {
      return `hey ${extractedName}! 👋 you're set up as an admin.

📢 "announce [message]" - send to all
📊 "poll [question]" - ask everyone
💬 ask me anything about the org`
    }
    return `hey ${extractedName}! 👋 you're all set. you'll get announcements and polls from the team.`
  }

  // If name extraction failed, ask again with a hint
  // Check if this is the first message (no name set yet)
  const isFirstMessage = !user.name && user.needs_name
  
  if (isFirstMessage) {
    return "hey you know jarvis from iron man? it's your lucky day, i'm your jarvis. what's your name?"
  }
  
  return "hey! i'm jarvis. what's your name?"
}

// ============================================
// ANNOUNCEMENT SENDING
// ============================================

async function sendAnnouncementToAll(content: string, senderPhone: string, spaceId?: string | null): Promise<number> {
  let users: { phone: string; name?: string | null }[] = []

  if (spaceId) {
    // Multi-space mode: get space members
    const members = await spaceContext.getSpaceMembers(spaceId)
    users = members.map(m => ({ phone: m.phoneNumber, name: m.name }))
  } else {
    // Legacy mode: get all opted-in members from Airtable
    users = await memberRepo.getOptedInMembers()
  }

  let sent = 0

  console.log(`[Announce] Sending to ${users.length} users${spaceId ? ` in space ${spaceId}` : ''}`)

  for (const user of users) {
    const userPhoneNormalized = user.phone ? normalizePhone(user.phone) : ''

    // Skip invalid phones only
    if (!userPhoneNormalized || userPhoneNormalized.length < 10) continue

    const result = await sendSms(toE164(userPhoneNormalized), content)
    if (result.ok) {
      // Log message for this recipient
      await messageRepo.logMessage(userPhoneNormalized, 'outbound', content, {
        action: 'announcement',
        senderPhone: normalizePhone(senderPhone)
      }, spaceId)
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

async function sendPollToAll(question: string, senderPhone: string, requiresExcuse: boolean = false, spaceId?: string | null): Promise<number> {
  // Create poll in database with progressive ID (space-scoped)
  const poll = await pollRepo.createPoll(question, senderPhone, requiresExcuse, spaceId)

  console.log(`[Poll] Created poll ${poll.pollIdentifier} in Postgres: "${question}"${spaceId ? ` (space: ${spaceId})` : ''}`)

  // Create Airtable fields for this poll using Metadata API (only for legacy/global polls or spaces with Airtable config)
  if (poll.pollIdentifier && !spaceId) {
    console.log(`[Poll] Creating Airtable fields for poll ${poll.pollIdentifier}`)
    const fieldsCreated = await ensurePollFieldsExist(poll.pollIdentifier, question)

    if (fieldsCreated) {
      console.log(`[Poll] ✓ Airtable fields created successfully`)
    } else {
      console.warn(`[Poll] ⚠ Airtable field creation failed - responses stored in Postgres only`)
    }
  }

  let users: { id?: string; phone: string; name?: string | null }[] = []

  if (spaceId) {
    // Multi-space mode: get space members
    const members = await spaceContext.getSpaceMembers(spaceId)
    users = members.map(m => ({ phone: m.phoneNumber, name: m.name }))
  } else {
    // Legacy mode: get all opted-in members from Airtable
    users = await memberRepo.getOptedInMembers()
  }

  let sent = 0

  console.log(`[Poll] Sending poll "${question}" to ${users.length} users (requiresExcuse: ${requiresExcuse})`)

  const excuseNote = requiresExcuse ? ' (if no explain why)' : ''
  const pollMessage = `📊 ${question}\n\nreply yes/no/maybe${excuseNote}`

  // Get poll field names for Airtable (only for legacy mode)
  const pollFields = {
    questionField: `POLL_Q_${poll.pollIdentifier}`,
    responseField: `POLL_R_${poll.pollIdentifier}`,
    notesField: `POLL_N_${poll.pollIdentifier}`
  }

  for (const user of users) {
    const userPhoneNormalized = user.phone ? normalizePhone(user.phone) : ''

    // Skip invalid phones only
    if (!userPhoneNormalized || userPhoneNormalized.length < 10) continue

    // Pre-populate poll fields in Airtable for this user (legacy mode only)
    if (!spaceId && user.id) {
      try {
        await memberRepo.updateMember(user.id, {
          [pollFields.questionField]: question,
          [pollFields.responseField]: '',
          [pollFields.notesField]: ''
        })
      } catch (err) {
        console.warn(`[Poll] Could not pre-populate Airtable for user ${user.id} (fields may not exist yet)`)
      }
    }

    const result = await sendSms(toE164(userPhoneNormalized), pollMessage)
    if (result.ok) {
      // Log message for this recipient
      await messageRepo.logMessage(userPhoneNormalized, 'outbound', pollMessage, {
        action: 'poll',
        pollId: poll.pollIdentifier,
        senderPhone: normalizePhone(senderPhone)
      }, spaceId)
      sent++
    }
  }

  console.log(`[Poll] Complete: sent=${sent}`)
  return sent
}

// ============================================
// KNOWLEDGE SEARCH
// ============================================
// CONTENT SEARCH HELPERS
// ============================================

import type { ContentResult, EventResult } from '@/lib/planner/actions/content'

async function searchFactsDatabase(query: string): Promise<ContentResult[]> {
  return routeContentSearch(query)
}

async function searchEventsDatabase(spaceId?: string | null): Promise<EventResult[]> {
  const events = await eventRepo.getUpcomingEvents(50, spaceId) // Get more events for comprehensive search
  const pastEvents = await eventRepo.getPastEvents(50, spaceId) // Also get past events
  
  return [...events, ...pastEvents].map(e => ({
    id: e.id,
    title: e.title,
    description: e.description,
    eventDate: e.eventDate,
    location: e.location,
    category: e.category,
    linkedFactId: e.linkedFactId
  }))
}

async function searchPastAnnouncements(spaceId?: string | null): Promise<Array<{
  type: 'announcement' | 'poll'
  content: string
  sentAt: Date
  sentBy: string
}>> {
  return messageRepo.getPastActions(20, spaceId)
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
