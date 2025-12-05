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

// In-memory state for admin drafts (simple approach)
const adminDrafts: Map<string, { type: 'announcement' | 'poll', content: string }> = new Map()

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
  const lower = message.toLowerCase().trim()
  
  // Check for admin commands FIRST (before user lookup)
  // This allows admins to use commands even on first text
  if (isAdmin(phone)) {
    // Quick announce: "announce meeting at 7pm"
    const announceMatch = message.match(/^announce\s+(.+)/i)
    if (announceMatch) {
      // Ensure admin exists in DB
      let user = await getUserByPhone(phone)
      if (!user) {
        user = await createUser(phone)
        await updateUser(user!.id, { Name: 'Admin', Needs_Name: false })
      }
      const content = announceMatch[1].trim()
      return await sendAnnouncementToAll(content, phone)
    }
    
    // Quick poll: "poll active meeting tonight?"
    const pollMatch = message.match(/^poll\s+(.+)/i)
    if (pollMatch) {
      // Ensure admin exists in DB
      let user = await getUserByPhone(phone)
      if (!user) {
        user = await createUser(phone)
        await updateUser(user!.id, { Name: 'Admin', Needs_Name: false })
      }
      const question = normalizePollQuestion(pollMatch[1].trim())
      return await sendPollToAll(question, phone)
    }
  }
  
  // Get or create user
  let user = await getUserByPhone(phone)
  
  if (!user) {
    // New user - create them
    user = await createUser(phone)
    
    // If first message looks like a name, save it immediately
    const looksLikeName = message.length < 50 && 
      message.length > 1 &&
      !/^(yes|no|maybe|\d+|stop|help|start|announce|poll|hi|hello|hey)/i.test(lower)
    
    if (looksLikeName) {
      await updateUser(user!.id, { Name: message.trim(), Needs_Name: false })
      if (isAdmin(phone)) {
        return `hey ${message}! 👋 you're set up as an admin.

📢 "announce [message]" - send to all
📊 "poll [question]" - ask everyone`
      }
      return `hey ${message}! 👋 you're all set. you'll get announcements and polls from the team.`
    }
    
    return "hey! i'm jarvis, powered by enclave. what's your name?"
  }
  
  // STOP command
  if (lower === 'stop') {
    await updateUser(user.id, { Opted_Out: true })
    return "you've been unsubscribed. text START to rejoin."
  }
  
  // START command
  if (lower === 'start') {
    await updateUser(user.id, { Opted_Out: false })
    return "welcome back! you're subscribed."
  }
  
  // HELP command
  if (lower === 'help') {
    if (isAdmin(phone)) {
      return `🤖 admin commands:
📢 "announce [message]" - send to everyone
📊 "poll [question]" - ask everyone
text STOP to unsubscribe`
    }
    return `🤖 jarvis help:
• reply to polls with yes/no/maybe
• add notes like "yes but running late"
• text STOP to unsubscribe`
  }
  
  // Name collection
  if (user.needs_name) {
    const looksLikeName = message.length < 50 && 
      !/^(yes|no|maybe|\d+|stop|help|start|announce|poll)/i.test(lower)
    
    if (looksLikeName) {
      await updateUser(user.id, { Name: message.trim(), Needs_Name: false })
      if (isAdmin(phone)) {
        return `nice to meet you ${message}! 👋 you're an admin.

📢 "announce [message]" - send to all
📊 "poll [question]" - ask everyone`
      }
      return `nice to meet you ${message}! 👋 you'll get announcements and polls from the team.`
    }
  }
  
  // Admin commands (for existing users - announce/poll already handled above for new admins)
  if (isAdmin(phone)) {
    // Check for pending draft
    const draft = adminDrafts.get(phone)
    
    // Send command
    if (/^(send|go|yes|ship)/i.test(lower) && draft) {
      adminDrafts.delete(phone)
      if (draft.type === 'announcement') {
        return await sendAnnouncementToAll(draft.content, phone)
      } else {
        return await sendPollToAll(draft.content, phone)
      }
    }
    
    // Cancel command
    if (/^(cancel|nvm|nevermind)/i.test(lower) && draft) {
      adminDrafts.delete(phone)
      return "discarded."
    }
    
    // Start announcement flow
    if (/make an announcement|send an announcement/i.test(lower)) {
      adminDrafts.set(phone, { type: 'announcement', content: '' })
      return "what would you like to announce?"
    }
    
    // Start poll flow
    if (/create a poll|make a poll|start a poll/i.test(lower)) {
      adminDrafts.set(phone, { type: 'poll', content: '' })
      return "what's your poll question?"
    }
    
    // If waiting for content
    if (draft && !draft.content) {
      draft.content = draft.type === 'poll' ? normalizePollQuestion(message) : message
      adminDrafts.set(phone, draft)
      return `📝 ready to send:\n\n"${draft.content}"\n\nreply "send" or "cancel"`
    }
  }
  
  // Poll response - check if user has pending poll
  if (user.pending_poll) {
    const parsed = parsePollResponse(message)
    await updateUser(user.id, {
      Pending_Poll: '',  // Clear pending
      Last_Response: parsed.response,
      Last_Notes: parsed.notes || ''
    })
    
    let reply = `got it! recorded: ${parsed.response}`
    if (parsed.notes) reply += ` (note: "${parsed.notes}")`
    return reply
  }
  
  // Default
  if (isAdmin(phone)) {
    return `📢 "announce [message]" - send to all
📊 "poll [question]" - ask everyone`
  }
  return "hey! text HELP for info."
}

// Send announcement to all (excluding the sender)
async function sendAnnouncementToAll(content: string, senderPhone?: string): Promise<string> {
  const users = await getOptedInUsers()
  const senderNormalized = senderPhone ? normalizePhone(senderPhone) : null
  let sent = 0
  let skipped = 0
  
  console.log(`[Announce] Sending to ${users.length} users (excluding sender: ${senderNormalized})`)
  
  for (const user of users) {
    const userPhoneNormalized = user.phone ? normalizePhone(user.phone) : ''
    
    // Skip users without valid phone numbers (check normalized length)
    if (!userPhoneNormalized || userPhoneNormalized.length < 10) {
      console.log(`[Announce] Skipping user ${user.id} - no valid phone (raw: "${user.phone}", normalized: "${userPhoneNormalized}")`)
      skipped++
      continue
    }
    
    // Skip the admin who sent the announcement
    if (userPhoneNormalized === senderNormalized) {
      console.log(`[Announce] Skipping sender: ${userPhoneNormalized}`)
      skipped++
      continue
    }
    
    console.log(`[Announce] Sending to ${user.name || 'unnamed'} (${userPhoneNormalized})`)
    const result = await sendSms(toE164(userPhoneNormalized), content)
    if (result.ok) {
      sent++
    } else {
      console.log(`[Announce] Failed to send to ${userPhoneNormalized}: ${result.error}`)
    }
  }
  
  console.log(`[Announce] Complete: sent=${sent}, skipped=${skipped}`)
  return `✅ sent to ${sent} people!`
}

// Send poll to all (excluding the sender)
async function sendPollToAll(question: string, senderPhone?: string): Promise<string> {
  const users = await getOptedInUsers()
  const senderNormalized = senderPhone ? normalizePhone(senderPhone) : null
  let sent = 0
  let updateFailed = 0
  
  console.log(`[Poll] Starting poll send to ${users.length} users, question: "${question}"`)
  
  const pollMessage = `📊 ${question}\n\nreply yes/no/maybe (add notes like "yes but running late")`
  
  for (const user of users) {
    const userPhoneNormalized = user.phone ? normalizePhone(user.phone) : ''
    
    // Skip users without valid phone or the admin who sent the poll
    if (!userPhoneNormalized || userPhoneNormalized.length < 10) {
      console.log(`[Poll] Skipping user ${user.id} - invalid phone`)
      continue
    }
    if (userPhoneNormalized === senderNormalized) {
      console.log(`[Poll] Skipping sender ${userPhoneNormalized}`)
      continue
    }
    
    console.log(`[Poll] Sending to ${user.name || 'unnamed'} (${userPhoneNormalized}), record ID: ${user.id}`)
    const result = await sendSms(toE164(userPhoneNormalized), pollMessage)
    
    if (result.ok) {
      sent++
      // Mark user as having pending poll
      console.log(`[Poll] SMS sent, now setting Pending_Poll for record ${user.id}`)
      const updateResult = await updateUser(user.id, { Pending_Poll: question })
      if (updateResult) {
        console.log(`[Poll] Successfully set Pending_Poll for ${user.id}`)
      } else {
        console.log(`[Poll] FAILED to set Pending_Poll for ${user.id}`)
        updateFailed++
      }
    } else {
      console.log(`[Poll] SMS failed for ${userPhoneNormalized}: ${result.error}`)
    }
  }
  
  console.log(`[Poll] Complete: sent=${sent}, updateFailed=${updateFailed}`)
  return `✅ poll sent to ${sent} people!`
}

// Normalize poll question
function normalizePollQuestion(raw: string): string {
  let q = raw.trim()
  if (!q.endsWith('?')) q += '?'
  if (!/^(are|do|will|can|is|yo|coming|going)/i.test(q)) {
    q = `yo are you coming to ${q.replace(/\?$/, '')}?`
  }
  return q
}

// Parse poll response
function parsePollResponse(message: string): { response: string; notes: string | null } {
  const lower = message.toLowerCase().trim()
  
  if (/^(yes|yeah|yep|ya|y|sure|ok|1)\b/i.test(lower)) {
    const notes = message.replace(/^(yes|yeah|yep|ya|y|sure|ok|1)\s*/i, '').replace(/^(but|though|,)\s*/i, '').trim()
    return { response: 'Yes', notes: notes || null }
  }
  
  if (/^(no|nope|nah|n|cant|can't|2)\b/i.test(lower)) {
    const notes = message.replace(/^(no|nope|nah|n|cant|can't|2)\s*/i, '').replace(/^(but|because|cuz|,)\s*/i, '').trim()
    return { response: 'No', notes: notes || null }
  }
  
  if (/^(maybe|possibly|idk|3)\b/i.test(lower)) {
    const notes = message.replace(/^(maybe|possibly|idk|3)\s*/i, '').replace(/^(but|,)\s*/i, '').trim()
    return { response: 'Maybe', notes: notes || null }
  }
  
  return { response: 'Unknown', notes: message }
}

export async function GET(request: NextRequest) {
  // Diagnostic endpoint - shows raw Airtable data for debugging
  try {
    // Import Airtable directly for raw access
    const Airtable = (await import('airtable')).default
    Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY })
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID!)
    const tableName = process.env.AIRTABLE_TABLE_NAME || 'Enclave'
    
    const records = await base(tableName).select({}).all()
    
    const rawRecords = records.map(r => ({
      id: r.id,
      fields: r.fields,
      fieldNames: Object.keys(r.fields)
    }))
    
    const users = await getOptedInUsers()
    const summary = users.map(u => ({
      id: u.id,
      name: u.name || '(no name)',
      hasPhone: !!u.phone && normalizePhone(u.phone).length >= 10,
      phoneRaw: u.phone || 'none',
      phoneNormalized: u.phone ? normalizePhone(u.phone) : 'none',
      optedOut: u.opted_out
    }))
    
    return NextResponse.json({
      status: 'running',
      tableName,
      rawRecordCount: records.length,
      rawRecords: rawRecords.slice(0, 5), // Show first 5 raw records for debugging
      processedUserCount: users.length,
      usersWithValidPhone: users.filter(u => u.phone && normalizePhone(u.phone).length >= 10).length,
      processedUsers: summary
    })
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      error: String(error)
    }, { status: 500 })
  }
}
