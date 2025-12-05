/**
 * SMS Webhook Handler (Planner-Based)
 * Uses the new planner system for intent classification and response generation
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getUserByPhone,
  createUser,
  updateUser,
  getOptedInUsers,
  normalizePhone,
  toE164,
  isAdmin
} from '@/lib/db'
import { validateTwilioSignature, toTwiml, sendSms } from '@/lib/twilio'
import { plan, UserContext } from '@/lib/planner'

// ============================================
// MAIN HANDLER
// ============================================

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

// ============================================
// MESSAGE HANDLER
// ============================================

async function handleMessage(phone: string, message: string): Promise<string> {
  const lower = message.toLowerCase().trim()
  
  // Get or create user
  let user = await getUserByPhone(phone)
  
  if (!user) {
    // New user
    user = await createUser(phone)
    
    // Check if first message looks like a name
    const looksLikeName = message.length < 50 && 
      message.length > 1 &&
      !/^(yes|no|maybe|\d+|stop|help|start|announce|poll|hi|hello|hey)/i.test(lower)
    
    if (looksLikeName) {
      await updateUser(user!.id, { Name: message.trim(), Needs_Name: false })
      if (isAdmin(phone)) {
        return `hey ${message}! 👋 you're set up as an admin.\n\n📢 "announce [message]" - send to all\n📊 "poll [question]" - ask everyone`
      }
      return `hey ${message}! 👋 you're all set. you'll get announcements and polls from the team.`
    }
    
    return "hey! i'm jarvis, powered by enclave. what's your name?"
  }
  
  // Handle system commands
  if (lower === 'stop') {
    await updateUser(user.id, { Opted_Out: true })
    return "you've been unsubscribed. text START to rejoin."
  }
  
  if (lower === 'start') {
    await updateUser(user.id, { Opted_Out: false })
    return "welcome back! you're subscribed."
  }
  
  // Handle name collection
  if (user.needs_name) {
    const looksLikeName = message.length < 50 && 
      !/^(yes|no|maybe|\d+|stop|help|start|announce|poll)/i.test(lower)
    
    if (looksLikeName) {
      await updateUser(user.id, { Name: message.trim(), Needs_Name: false })
      if (isAdmin(phone)) {
        return `nice to meet you ${message}! 👋 you're an admin.\n\n📢 "announce [message]" - send to all\n📊 "poll [question]" - ask everyone`
      }
      return `nice to meet you ${message}! 👋 you'll get announcements and polls from the team.`
    }
  }
  
  // Handle poll responses (if user has pending poll)
  if (user.pending_poll) {
    const pollResponse = parsePollResponse(message)
    if (pollResponse.response !== 'Unknown') {
      await updateUser(user.id, {
        Last_Response: pollResponse.response,
        Last_Notes: pollResponse.notes || ''
      })
      
      let reply = `got it! recorded: ${pollResponse.response}`
      if (pollResponse.notes) reply += ` (note: "${pollResponse.notes}")`
      return reply
    }
  }
  
  // Build user context for planner
  const userContext: UserContext = {
    phone,
    name: user.name,
    isAdmin: isAdmin(phone),
    needsName: user.needs_name,
    optedOut: user.opted_out
  }
  
  // Use planner for everything else
  const result = await plan({
    phone,
    message,
    user: userContext,
    sendAnnouncement: (content) => sendAnnouncementToAll(content, phone),
    sendPoll: (question) => sendPollToAll(question, phone)
  })
  
  console.log(`[SMS] Planner result: action=${result.action}, classification=${JSON.stringify(result.classification)}`)
  
  return result.response
}

// ============================================
// SEND FUNCTIONS
// ============================================

async function sendAnnouncementToAll(content: string, senderPhone: string): Promise<number> {
  const users = await getOptedInUsers()
  const senderNormalized = normalizePhone(senderPhone)
  let sent = 0
  
  for (const user of users) {
    const userPhoneNormalized = user.phone ? normalizePhone(user.phone) : ''
    
    if (!userPhoneNormalized || userPhoneNormalized.length < 10) continue
    if (userPhoneNormalized === senderNormalized) continue
    
    const result = await sendSms(toE164(userPhoneNormalized), content)
    if (result.ok) sent++
  }
  
  return sent
}

async function sendPollToAll(question: string, senderPhone: string): Promise<number> {
  const users = await getOptedInUsers()
  const senderNormalized = normalizePhone(senderPhone)
  let sent = 0
  
  const pollMessage = `📊 ${question}\n\nreply yes/no/maybe (add notes like "yes but running late")`
  
  for (const user of users) {
    const userPhoneNormalized = user.phone ? normalizePhone(user.phone) : ''
    
    if (!userPhoneNormalized || userPhoneNormalized.length < 10) continue
    if (userPhoneNormalized === senderNormalized) continue
    
    const result = await sendSms(toE164(userPhoneNormalized), pollMessage)
    if (result.ok) {
      sent++
      // Mark user as having pending poll
      await updateUser(user.id, { Pending_Poll: question })
    }
  }
  
  return sent
}

// ============================================
// POLL RESPONSE PARSER
// ============================================

function parsePollResponse(message: string): { response: string; notes: string | null } {
  const lower = message.toLowerCase().trim()
  
  // Negative patterns
  const negativePatterns = [
    /\b(can'?t|cannot|won'?t|unable|not coming|not going|busy|unavailable)\b/i,
    /^(n|no|nope|nah)$/i
  ]
  
  for (const pattern of negativePatterns) {
    if (pattern.test(lower)) {
      const note = message.replace(/^(no|nope|nah|n)\s*/i, '').trim()
      return { response: 'No', notes: note || null }
    }
  }
  
  // Affirmative patterns
  const affirmativePatterns = [
    /\b(coming|going|will be there|i'll be there|count me in|i'm in|yes|yep|yeah)\b/i,
    /^(y|yes|yep|yeah|yea|yup)$/i
  ]
  
  for (const pattern of affirmativePatterns) {
    if (pattern.test(lower)) {
      const note = message.replace(/^(yes|yep|yeah|yea|yup|y)\s*/i, '').trim()
      return { response: 'Yes', notes: note || null }
    }
  }
  
  // Maybe patterns
  const maybePatterns = [
    /\b(maybe|might|possibly|not sure|depends|idk)\b/i
  ]
  
  for (const pattern of maybePatterns) {
    if (pattern.test(lower)) {
      const note = message.replace(/^(maybe|might)\s*/i, '').trim()
      return { response: 'Maybe', notes: note || null }
    }
  }
  
  // Check for late mentions (implies yes)
  if (/\b(late|running late)\b/i.test(lower)) {
    return { response: 'Yes', notes: message }
  }
  
  return { response: 'Unknown', notes: message }
}

// ============================================
// DIAGNOSTIC ENDPOINT
// ============================================

export async function GET(request: NextRequest) {
  try {
    const users = await getOptedInUsers()
    
    return NextResponse.json({
      status: 'running',
      version: 'planner-based',
      userCount: users.length,
      usersWithPhone: users.filter(u => u.phone && normalizePhone(u.phone).length >= 10).length
    })
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      error: String(error)
    }, { status: 500 })
  }
}

