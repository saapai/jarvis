import { NextRequest, NextResponse } from 'next/server'
import { validateTwilioSignature, toTwiml, sendSms } from '@/lib/twilio'
import { normalizePhone, toE164 } from '@/lib/db'
import { classifyIntent } from '@/lib/planner/classifier'
import { buildWeightedHistoryFromMessages } from '@/lib/planner/history'
import * as actions from '@/lib/planner/actions'
import * as messageRepo from '@/lib/repositories/messageRepository'
import * as draftRepo from '@/lib/repositories/draftRepository'
import * as convRepo from '@/lib/repositories/conversationRepository'
import * as memberRepo from '@/lib/repositories/memberRepository'
import * as eventRepo from '@/lib/repositories/eventRepository'
import * as spaceContext from '@/lib/spaceContext'
import type { ActionResult } from '@/lib/planner/types'
import { routeContentSearch } from '@/text-explorer/router'
import { extractName } from '@/lib/planner/nameExtraction'

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
  // 0a. Nothing to work with (media-only MMS, whitespace) — don't run classification on it
  if (!message || message.trim().length === 0) {
    return "i got a blank message — text me words and i'll do my thing"
  }

  // 0. Check for space commands (JOIN, SPACES)
  const spaceCommandResponse = await handleSpaceCommand(phone, message)
  if (spaceCommandResponse) {
    await messageRepo.logMessage(phone, 'outbound', spaceCommandResponse, { action: 'space_command' })
    return spaceCommandResponse
  }

  // 1. Get active space for this user
  let activeSpaceId: string | null = await spaceContext.getActiveSpaceId(phone)

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
        needs_name: !spaceMember.name, // Will be true if name is null
        opted_out: spaceMember.optedOut,
        pending_poll: null,
        last_response: null,
        last_notes: null
      }
    }
  }

  // Fallback to legacy Airtable-based member lookup (only if not in a space)
  if (!user && !activeSpaceId) {
    user = await memberRepo.getMember(phone)
    if (!user) {
      user = await memberRepo.createMember(phone)
      if (!user) {
        // Check if user has any spaces they could join
        const userSpaces = await spaceContext.getUserSpacesByPhone(phone)
        if (userSpaces.length === 0) {
          return "hey! text JOIN <code> to join a space. ask your admin for the code."
        }
        return "hey! couldn't create your account. try again?"
      }
    }
  }
  
  // If we have activeSpaceId but no user yet, try to get/create user from Prisma
  if (!user && activeSpaceId) {
    const prisma = await (await import('@/lib/prisma')).getPrisma()
    let prismaUser = await prisma.user.findUnique({
      where: { phoneNumber: normalizePhone(phone) }
    })

    if (!prismaUser) {
      prismaUser = await prisma.user.create({
        data: { phoneNumber: normalizePhone(phone) }
      })
      console.log(`[SMS] Created Prisma user for phone ${phone}`)
    }
    
    // Get space member
    const spaceMember = await prisma.spaceMember.findUnique({
      where: {
        spaceId_userId: {
          spaceId: activeSpaceId,
          userId: prismaUser.id
        }
      },
      include: { user: true }
    })
    
    if (spaceMember) {
      user = {
        id: spaceMember.userId,
        phone: spaceMember.user.phoneNumber,
        name: spaceMember.name || spaceMember.user.name,
        needs_name: !(spaceMember.name || spaceMember.user.name),
        opted_out: spaceMember.optedOut,
        pending_poll: null,
        last_response: null,
        last_notes: null
      }
      isSpaceMember = true
      console.log(`[AutoBypass] Found space member for test phone`)
    }
  }

  // Ensure we have a user at this point
  if (!user) {
    return "hey! couldn't create your account. try again?"
  }

  // 3. Handle system commands (STOP, START, HELP)
  const systemResponse = await handleSystemCommand(user, message, activeSpaceId)
  if (systemResponse) {
    await messageRepo.logMessage(phone, 'outbound', systemResponse, { action: 'system_command' }, activeSpaceId)
    return systemResponse
  }

  // 3b. Opted-out users only get system commands (START/STOP/HELP are handled above)
  if (user.opted_out) {
    const optedOutResponse = "you're unsubscribed rn, so i'm staying quiet. text START to rejoin."
    await messageRepo.logMessage(phone, 'outbound', optedOutResponse, { action: 'opted_out_guard' }, activeSpaceId)
    return optedOutResponse
  }

  // 4. Handle onboarding (name collection)
  if (user.needs_name) {
    console.log(`[Onboarding] User needs name - name: ${user.name}, needs_name: ${user.needs_name}`)
    const onboardingResponse = await handleOnboarding(phone, message, user, activeSpaceId, isSpaceMember)
    console.log(`[Onboarding] Response: ${onboardingResponse.substring(0, 100)}...`)
    await messageRepo.logMessage(phone, 'outbound', onboardingResponse, { action: 'onboarding' }, activeSpaceId)
    return onboardingResponse
  } else {
    console.log(`[Onboarding] Skipped - user.name: ${user.name}, user.needs_name: ${user.needs_name}`)
  }

  // 5. Load conversation context (space-scoped)
  const recentMessages = await messageRepo.getRecentMessages(phone, 10, activeSpaceId)
  const history = buildWeightedHistoryFromMessages(recentMessages)
  const convState = await convRepo.getConversationState(phone, activeSpaceId)
  const activeDraft = await draftRepo.getActiveDraft(phone, activeSpaceId)

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
    userName: user.name
  }

  const classification = await classifyIntent(context)
  console.log(`[Classification] ${classification.action} (${classification.confidence.toFixed(2)}) - ${classification.reasoning}`)
  console.log(`[ActionRouter] Routing to ${classification.action} handler...`)

  // 7. Route to appropriate handler
  let actionResult: ActionResult

  // Phone number restriction: only authorized number can send announcements
  const authorizedSender = process.env.AUTHORIZED_SENDER_PHONE || ''
  const isSenderAuthorized = authorizedSender ? normalizePhone(phone) === normalizePhone(authorizedSender) : isAdmin

  switch (classification.action) {
    case 'draft_write':
      if (!isSenderAuthorized) {
        console.log(`[DraftWrite] Unauthorized phone ${phone} - only ${authorizedSender || 'admins'} can send announcements`)
        actionResult = {
          action: 'chat',
          response: "only the admin can send announcements. if you need something sent out, let them know"
        }
        break
      }
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
      if (!isSenderAuthorized) {
        console.log(`[DraftSend] Unauthorized phone ${phone}`)
        actionResult = {
          action: 'chat',
          response: "only the admin can send announcements. if you need something sent out, let them know"
        }
        break
      }
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
        spaceId: activeSpaceId
      })
      console.log(`[DraftSend] Result: ${actionResult.response.substring(0, 50)}...`)
      break

    case 'draft_cancel':
      console.log(`[DraftCancel] Scrapping active draft...`)
      actionResult = await actions.handleDraftCancel({
        phone,
        message,
        userName: user.name,
        spaceId: activeSpaceId
      })
      break

    case 'content_query':
      console.log(`[ContentQuery] Querying content for: "${message}"`)
      actionResult = await actions.handleContentQuery({
        phone,
        message,
        userName: user.name,
        searchContent: (query: string) => searchFactsDatabase(query, activeSpaceId),
        searchEvents: () => searchEventsDatabase(activeSpaceId),
        recentMessages,
        searchPastActions: () => searchPastAnnouncements(activeSpaceId)
      })
      console.log(`[ContentQuery] Result: ${actionResult.response.substring(0, 50)}...`)
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
        isAdmin,
        // Attach current active space if any so uploads are space-scoped
        spaceId: activeSpaceId
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
        isAdmin,
        recentMessages,
        searchContent: (query: string) => searchFactsDatabase(query, activeSpaceId)
      })
      console.log(`[Chat] Result: ${actionResult.response.substring(0, 50)}...`)
      break
  }
  
  console.log(`[ActionRouter] Action complete, applying personality...`)

  // 8. Every handler now returns text already in Jarvis's voice — the chat/content
  //    handlers generate it via the LLM, and the structured handlers (draft, cancel,
  //    capability, knowledge, event) return clean in-voice templates. There's no
  //    separate personality-application pass anymore; a second wrapper only ever
  //    stacked canned sass onto text that didn't need it.
  const finalResponse = actionResult.response

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
📅 events: "move meeting to 7pm" or "ski retreat is jan 16-19"
📢 announcements: "announce [message]" - send to everyone
📝 knowledge: text me info to add to your space
💬 ask me questions about the org
📎 file uploads: use tryenclave.com
text SPACES to see your spaces
text STOP to unsubscribe`
    }
    return `🤖 jarvis help:
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
/**
 * Use LLM to intelligently extract a name from a message
 * Returns null if the message doesn't contain a name
 */
async function handleOnboarding(phone: string, message: string, user: any, activeSpaceId?: string | null, isSpaceMember?: boolean): Promise<string> {
  const extractedName = await extractName(message)

  if (extractedName) {
    // Only update Airtable if user is NOT a space member (legacy mode)
    // Space members are stored in Prisma, not Airtable
    if (!isSpaceMember) {
      await memberRepo.updateMemberName(user.id, extractedName)
    }

    // Update space member name if in a space
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
💬 ask me anything about the org`
    }
    return `hey ${extractedName}! 👋 you're all set. you'll get announcements and updates from the team.`
  }

  // If name extraction failed, ask again with a hint
  // Check if this is the first message (no name set yet)
  const isFirstMessage = !user.name && user.needs_name
  
  if (isFirstMessage) {
    return "hey you know jarvis from iron man? it's your lucky day, i'm your jarvis. what's your name?\n\ngo to tryenclave.com to access your space and upload information"
  }
  
  return "hey! i'm jarvis. what's your name?\n\ngo to tryenclave.com to access your space and upload information"
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
// KNOWLEDGE SEARCH
// ============================================
// CONTENT SEARCH HELPERS
// ============================================

import type { ContentResult, EventResult } from '@/lib/planner/actions/content'

async function searchFactsDatabase(query: string, spaceId?: string | null): Promise<ContentResult[]> {
  return routeContentSearch(query, spaceId)
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

    return NextResponse.json({
      status: 'running',
      version: '2.0-planner',
      members: users.length
    })
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      error: String(error)
    }, { status: 500 })
  }
}
