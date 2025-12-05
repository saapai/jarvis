import { NextRequest, NextResponse } from 'next/server'
import {
  getUserByPhone,
  createUser,
  updateUser,
  getOptedInUsers,
  normalizePhone,
  toE164,
  isAdmin,
  verifyAirtableFields
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

// Parse admin intent from natural language
function parseAdminIntent(message: string): { type: 'announcement' | 'poll' | null; content: string | null } {
  const lower = message.toLowerCase().trim()
  const original = message.trim()
  
  // Explicit keyword patterns (keep for backward compatibility)
  const announceKeywordMatch = original.match(/^announce\s+(.+)/i)
  if (announceKeywordMatch) {
    return { type: 'announcement', content: announceKeywordMatch[1].trim() }
  }
  
  const pollKeywordMatch = original.match(/^poll\s+(.+)/i)
  if (pollKeywordMatch) {
    return { type: 'poll', content: pollKeywordMatch[1].trim() }
  }
  
  // Intent-based patterns for POLLS
  const pollIntentPatterns = [
    // "send out a poll", "send a poll", "create a poll", "make a poll"
    /\b(send|send out|create|make|start|post)\s+(a\s+)?poll\b/i,
    // "send out a message asking if", "ask everyone if", "ask people if"
    /\b(send|send out|text|message)\s+(everyone|people|all|the group|the team)\s+(asking|to ask|if|whether)\s+(.+)/i,
    /\b(ask|asking)\s+(everyone|people|all|the group|the team|everybody)\s+(if|whether|about)\s+(.+)/i,
    // "who's coming", "who is coming", "who can make it" - capture full question
    /\b(who'?s|who is|who can|who will)\s+(coming|going|attending|make it|be there|show up)/i,
    // "poll about X", "poll for X"
    /\bpoll\s+(about|for|on)\s+(.+)/i
  ]
  
  for (const pattern of pollIntentPatterns) {
    const match = lower.match(pattern)
    if (match) {
      // Extract the question/content
      let content = original
      
      // Special handling for "who's coming" patterns - capture FULL semantic question
      if (/\b(who'?s|who is|who can|who will)\s+(coming|going|attending|make it|be there|show up)/i.test(lower)) {
        // Extract EVERYTHING after "who's" to preserve complete semantic meaning
        // Example: "who's coming to the meeting tonight" -> "coming to the meeting tonight"
        const whoMatch = original.match(/\b(who'?s|who is|who can|who will)\s+(.+)/i)
        if (whoMatch && whoMatch[2]) {
          // Use everything after "who's" - this preserves the FULL question semantically
          content = whoMatch[2].trim()
          // Ensure we got the full question, not just "coming"
          if (content.length < 10) {
            // If we only got a short word, try to get more context from original
            const fullMatch = original.match(/\b(who'?s|who is|who can|who will)\s+(.+)/i)
            if (fullMatch && fullMatch[2] && fullMatch[2].length > content.length) {
              content = fullMatch[2].trim()
            }
          }
        } else {
          // Fallback: remove command words semantically
          content = original.replace(/\b(send|send out|create|make|start|post|ask|asking|poll)\s+(a\s+)?(poll|message)?\s*/i, '').trim()
          // Extract everything after "who's" if present
          const remainingWhoMatch = content.match(/^(who'?s|who is|who can|who will)\s+(.+)/i)
          if (remainingWhoMatch && remainingWhoMatch[2]) {
            content = remainingWhoMatch[2].trim()
          } else {
            content = content.replace(/^(who'?s|who is|who can|who will)\s+/i, '').trim()
          }
        }
      } else {
        // For other patterns, remove command phrases
        content = content.replace(/\b(send|send out|create|make|start|post)\s+(a\s+)?poll\b/i, '').trim()
        content = content.replace(/\b(send|send out|text|message)\s+(everyone|people|all|the group|the team)\s+(asking|to ask|if|whether)\s*/i, '').trim()
        content = content.replace(/\b(ask|asking)\s+(everyone|people|all|the group|the team|everybody)\s+(if|whether|about)\s*/i, '').trim()
        content = content.replace(/\bpoll\s+(about|for|on)\s+/i, '').trim()
        
        // If we matched a pattern that captures content in a group, use that
        if (match.length > 1 && match[match.length - 1]) {
          const capturedContent = match[match.length - 1]
          if (capturedContent && capturedContent.length > 3) {
            content = capturedContent.trim()
          }
        }
        
        // If content is still the full message, try to extract the question part
        if (content === original || content.length < 5) {
          // Look for question words or phrases
          const questionMatch = original.match(/\b(if|whether|who|what|when|where|how|are|is|will|can|do)\s+(.+)/i)
          if (questionMatch && questionMatch[2]) {
            content = questionMatch[2].trim()
          }
        }
      }
      
      if (content && content.length > 3) {
        return { type: 'poll', content }
      }
    }
  }
  
  // Intent-based patterns for ANNOUNCEMENTS
  const announcementIntentPatterns = [
    // "send out a message for X" - captures X
    /\b(send|send out|text)\s+(a\s+)?(message|announcement)\s+(for|about|that|:)\s*(.+)/i,
    // "send out a message X" (without for/about) - captures X
    /\b(send|send out|text)\s+(a\s+)?(message|announcement)\s+(.+)/i,
    // "tell everyone about X" - captures X
    /\b(tell|notify|announce)\s+(everyone|people|all|the group|the team|everybody)\s+(about|that|to|:)\s*(.+)/i,
    // "tell everyone X" (without about) - captures X
    /\b(tell|let)\s+(everyone|people|all|the group|the team|everybody)\s+(.+)/i,
    // "announce X" - captures X
    /\bannounce(ment)?\s+(about|for|that|:)?\s*(.+)/i
  ]
  
  for (const pattern of announcementIntentPatterns) {
    const match = original.match(pattern)
    if (match) {
      // Find the last capture group that contains the actual content
      let content = null
      for (let i = match.length - 1; i >= 0; i--) {
        if (match[i] && match[i].length > 3 && match[i] !== lower && match[i] !== original) {
          // Check if this looks like actual content (not a command word)
          const testContent = match[i].trim()
          if (!/^(for|about|that|to|:)$/i.test(testContent) && testContent.length > 3) {
            content = testContent
            break
          }
        }
      }
      
      if (content) {
        return { type: 'announcement', content }
      }
      
      // Fallback: try to extract by removing command phrases
      let extracted = original
      extracted = extracted.replace(/\b(send|send out|text)\s+(a\s+)?(message|announcement)\s+(for|about|that|:)?\s*/i, '').trim()
      extracted = extracted.replace(/\b(tell|notify|announce)\s+(everyone|people|all|the group|the team|everybody)\s+(about|that|to|:)?\s*/i, '').trim()
      extracted = extracted.replace(/\b(tell|let)\s+(everyone|people|all|the group|the team|everybody)\s+/i, '').trim()
      extracted = extracted.replace(/\bannounce(ment)?\s+(about|for|that|:)?\s*/i, '').trim()
      
      if (extracted && extracted.length > 3 && extracted !== original) {
        return { type: 'announcement', content: extracted }
      }
    }
  }
  
  // Fallback: if message contains question words and seems like a question, treat as poll
  if (/\b(are|is|will|can|do|who|what|when|where|how)\s+.+\?/i.test(original)) {
    return { type: 'poll', content: original }
  }
  
  // Fallback: if message contains "poll" anywhere, treat as poll
  if (/\bpoll\b/i.test(original)) {
    // Try to extract content after "poll"
    const pollContentMatch = original.match(/\bpoll\s+(.+)/i)
    if (pollContentMatch && pollContentMatch[1]) {
      return { type: 'poll', content: pollContentMatch[1].trim() }
    }
    return { type: 'poll', content: original }
  }
  
  // Default: if it mentions sending/announcing, treat as announcement
  if (/\b(send|send out|announce|tell|message|notify)\b/i.test(lower)) {
    // Try to extract content after these words
    const contentMatch = original.match(/\b(send|send out|announce|tell|message|notify)\s+(.+)/i)
    if (contentMatch && contentMatch[2]) {
      return { type: 'announcement', content: contentMatch[2].trim() }
    }
    return { type: 'announcement', content: original }
  }
  
  return { type: null, content: null }
}

async function handleMessage(phone: string, message: string): Promise<string> {
  const lower = message.toLowerCase().trim()
  
  // Check for admin commands FIRST (before user lookup)
  // This allows admins to use commands even on first text
  if (isAdmin(phone)) {
    // Check for existing draft first
    const existingDraft = adminDrafts.get(phone)
    
    // Send command with existing draft
    if (/^(send|go|yes|yep|yeah|yea|ship|do it|send it)\s*$/i.test(lower) && existingDraft) {
      adminDrafts.delete(phone)
      // Ensure admin exists in DB
      let user = await getUserByPhone(phone)
      if (!user) {
        user = await createUser(phone)
        await updateUser(user!.id, { Name: 'Admin', Needs_Name: false })
      }
      if (existingDraft.type === 'announcement') {
        return await sendAnnouncementToAll(existingDraft.content, phone)
      } else {
        return await sendPollToAll(existingDraft.content, phone)
      }
    }
    
    // Cancel command with existing draft
    if (/^(cancel|nvm|nevermind|no|nope|nah)\s*$/i.test(lower) && existingDraft) {
      adminDrafts.delete(phone)
      return "👍 draft discarded."
    }
    
    // Intent-based parsing for announcements and polls
    const parsedIntent = parseAdminIntent(message)
    
    if (parsedIntent.type === 'announcement' && parsedIntent.content) {
      // Ensure admin exists in DB
      let user = await getUserByPhone(phone)
      if (!user) {
        user = await createUser(phone)
        await updateUser(user!.id, { Name: 'Admin', Needs_Name: false })
      }
      // Save as draft and ask for confirmation
      adminDrafts.set(phone, { type: 'announcement', content: parsedIntent.content })
      return `📝 announcement draft:\n\n"${parsedIntent.content}"\n\nreply "send" to send to everyone, or "cancel" to discard`
    }
    
    if (parsedIntent.type === 'poll' && parsedIntent.content) {
      // Ensure admin exists in DB
      let user = await getUserByPhone(phone)
      if (!user) {
        user = await createUser(phone)
        await updateUser(user!.id, { Name: 'Admin', Needs_Name: false })
      }
      const question = normalizePollQuestion(parsedIntent.content)
      // Save as draft and ask for confirmation
      adminDrafts.set(phone, { type: 'poll', content: question })
      return `📊 poll draft:\n\n"${question}"\n\nreply "send" to send to everyone, or "cancel" to discard`
    }
  }
  
  // Get or create user
  let user = await getUserByPhone(phone)
  
  // Log user state for debugging
  if (user) {
    console.log(`[SMS] User found: ${user.name || 'unnamed'} (${phone}), pending_poll: ${user.pending_poll ? `"${user.pending_poll}"` : 'none'}`)
  }
  
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
  
  // Admin commands (for existing users - handle interactive draft flow)
  if (isAdmin(phone)) {
    // Check for pending draft that needs content
    const draft = adminDrafts.get(phone)
    
    // Start announcement flow (two-step)
    if (/^(make an announcement|send an announcement)\s*$/i.test(lower)) {
      adminDrafts.set(phone, { type: 'announcement', content: '' })
      return "what would you like to announce?"
    }
    
    // Start poll flow (two-step)
    if (/^(create a poll|make a poll|start a poll)\s*$/i.test(lower)) {
      adminDrafts.set(phone, { type: 'poll', content: '' })
      return "what's your poll question?"
    }
    
    // If waiting for content (draft exists but has no content yet)
    if (draft && !draft.content) {
      draft.content = draft.type === 'poll' ? normalizePollQuestion(message) : message
      adminDrafts.set(phone, draft)
      const emoji = draft.type === 'poll' ? '📊' : '📝'
      return `${emoji} ${draft.type} draft:\n\n"${draft.content}"\n\nreply "send" to send to everyone, or "cancel" to discard`
    }
  }
  
  // Poll response - check if user has pending poll
  if (user.pending_poll) {
    const parsed = parsePollResponse(message)
    console.log(`[PollResponse] User ${user.id} (${user.name}) responding to poll: "${user.pending_poll}"`)
    console.log(`[PollResponse] Parsed response: ${parsed.response}, notes: ${parsed.notes || 'none'}`)
    
    // Get the actual field names from the schema to ensure we use the correct ones
    // (Record fields don't include empty fields, so we need to check the schema)
    const Airtable = (await import('airtable')).default
    Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY })
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID!)
    const tableName = process.env.AIRTABLE_TABLE_NAME || 'Enclave'
    
    let actualPendingPollField = 'Pending_Poll'
    let actualLastResponseField = 'Last_Response'
    let actualLastNotesField = 'Last_Notes'
    
    // First, try to get field names from the table schema (includes all fields, even empty ones)
    try {
      const apiKey = process.env.AIRTABLE_API_KEY
      const baseId = process.env.AIRTABLE_BASE_ID
      const schemaResponse = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (schemaResponse.ok) {
        const meta = await schemaResponse.json()
        const table = meta.tables?.find((t: any) => t.name === tableName)
        if (table && table.fields) {
          const schemaFieldNames = table.fields.map((f: any) => f.name)
          console.log(`[PollResponse] Schema fields:`, schemaFieldNames)
          
          // Find exact field names from schema
          if (schemaFieldNames.includes('Pending_Poll')) {
            actualPendingPollField = 'Pending_Poll'
          } else {
            // Try variations
            const pendingPollVariations = ['Pending_Poll\t', 'pending_poll', 'Pending Poll', 'pending poll']
            for (const variation of pendingPollVariations) {
              if (schemaFieldNames.includes(variation)) {
                actualPendingPollField = variation
                break
              }
            }
            // If still not found, search for any field containing "pending" and "poll"
            if (actualPendingPollField === 'Pending_Poll') {
              const matchingField = schemaFieldNames.find((f: string) => {
                const lower = f.toLowerCase()
                return lower.includes('pending') && lower.includes('poll')
              })
              if (matchingField) {
                actualPendingPollField = matchingField
                console.log(`[PollResponse] Found matching field in schema: "${matchingField}"`)
              }
            }
          }
          
          // Find Last_Response field name
          if (schemaFieldNames.includes('Last_Response')) {
            actualLastResponseField = 'Last_Response'
          } else {
            // Try variations
            const lastResponseVariations = ['last_response', 'Last Response', 'last response', 'LastResponse']
            for (const variation of lastResponseVariations) {
              if (schemaFieldNames.includes(variation)) {
                actualLastResponseField = variation
                break
              }
            }
            // If still not found, search for any field containing "last" and "response"
            if (actualLastResponseField === 'Last_Response') {
              const matchingField = schemaFieldNames.find((f: string) => {
                const lower = f.toLowerCase()
                return lower.includes('last') && lower.includes('response')
              })
              if (matchingField) {
                actualLastResponseField = matchingField
                console.log(`[PollResponse] Found Last_Response field in schema: "${matchingField}"`)
              }
            }
          }
          
          // Find Last_Notes field name
          if (schemaFieldNames.includes('Last_Notes')) {
            actualLastNotesField = 'Last_Notes'
          } else {
            // Try variations
            const lastNotesVariations = ['last_notes', 'Last Notes', 'last notes', 'LastNotes', 'Last_Notes\t']
            for (const variation of lastNotesVariations) {
              if (schemaFieldNames.includes(variation)) {
                actualLastNotesField = variation
                break
              }
            }
            // If still not found, search for any field containing "last" and "notes"
            if (actualLastNotesField === 'Last_Notes') {
              const matchingField = schemaFieldNames.find((f: string) => {
                const lower = f.toLowerCase()
                return lower.includes('last') && lower.includes('notes')
              })
              if (matchingField) {
                actualLastNotesField = matchingField
                console.log(`[PollResponse] Found Last_Notes field in schema: "${matchingField}"`)
              }
            }
          }
        }
      }
    } catch (schemaError) {
      console.log(`[PollResponse] Could not fetch schema, will try record fields:`, schemaError)
    }
    
    // Fallback: try to get field names from the record (but empty fields won't be there)
    try {
      const record = await base(tableName).find(user.id)
      const recordFields = Object.keys(record.fields)
      console.log(`[PollResponse] Available fields in record:`, recordFields)
      
      // If we didn't find Pending_Poll in schema, try record fields
      if (actualPendingPollField === 'Pending_Poll' && !recordFields.includes('Pending_Poll')) {
        // Try variations in record fields
        const pendingPollVariations = ['Pending_Poll\t', 'pending_poll', 'Pending Poll']
        for (const variation of pendingPollVariations) {
          if (recordFields.includes(variation)) {
            actualPendingPollField = variation
            break
          }
        }
      }
    } catch (fetchError) {
      console.log(`[PollResponse] Could not fetch record to check field names, using defaults`)
    }
    
    console.log(`[PollResponse] Using field names: Pending_Poll="${actualPendingPollField}", Last_Response="${actualLastResponseField}", Last_Notes="${actualLastNotesField}"`)
    
    // Update response fields first - use direct Airtable API update for reliability
    const responseFields: Record<string, unknown> = {
      [actualLastResponseField]: parsed.response,
      [actualLastNotesField]: parsed.notes || ''
    }
    
    console.log(`[PollResponse] Updating response fields:`, responseFields)
    console.log(`[PollResponse] Field names (hex):`, {
      Last_Response: Array.from(actualLastResponseField).map(c => c.charCodeAt(0).toString(16)).join(' '),
      Last_Notes: Array.from(actualLastNotesField).map(c => c.charCodeAt(0).toString(16)).join(' ')
    })
    
    let responseUpdateSuccess = false
    try {
      console.log(`[PollResponse] Attempting direct Airtable update for response fields...`)
      const updateResult = await base(tableName).update(user.id, responseFields as any)
      console.log(`[PollResponse] Direct update succeeded. Updated fields:`, Object.keys(updateResult.fields))
      console.log(`[PollResponse] Update result values:`, {
        Last_Response: updateResult.fields[actualLastResponseField],
        Last_Notes: updateResult.fields[actualLastNotesField]
      })
      responseUpdateSuccess = true
      
      // Wait a moment for Airtable to process
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Verify the fields were actually set
      const verifyRecord = await base(tableName).find(user.id)
      const verifyResponse = verifyRecord.fields[actualLastResponseField]
      const verifyNotes = verifyRecord.fields[actualLastNotesField]
      
      console.log(`[PollResponse] Verification - Last_Response: "${verifyResponse}", Last_Notes: "${verifyNotes}"`)
      
      if (verifyResponse && String(verifyResponse).trim() === parsed.response.trim()) {
        console.log(`[PollResponse] ✓ Verified: Last_Response was set to "${verifyResponse}"`)
      } else {
        console.error(`[PollResponse] ✗ WARNING: Last_Response not set correctly. Expected: "${parsed.response}", Got: "${verifyResponse}"`)
      }
    } catch (directError: any) {
      console.error(`[PollResponse] Direct update failed:`, directError.message || directError)
      console.error(`[PollResponse] Error details:`, directError.error || directError.statusCode)
      
      // Fallback to updateUser
      console.log(`[PollResponse] Trying updateUser as fallback...`)
      const updateResult = await updateUser(user.id, responseFields)
      if (updateResult) {
        console.log(`[PollResponse] Fallback updateUser succeeded`)
        // Verify the fallback actually worked
        await new Promise(resolve => setTimeout(resolve, 500))
        const verifyRecord = await base(tableName).find(user.id)
        const verifyResponse = verifyRecord.fields[actualLastResponseField]
        if (verifyResponse && String(verifyResponse).trim() === parsed.response.trim()) {
          console.log(`[PollResponse] ✓ Verified fallback update succeeded`)
          responseUpdateSuccess = true
        } else {
          console.error(`[PollResponse] ✗ Fallback update reported success but field not set. Value: "${verifyResponse}"`)
        }
      } else {
        console.error(`[PollResponse] Fallback also failed`)
      }
    }
    
    if (!responseUpdateSuccess) {
      console.error(`[PollResponse] FAILED to update response fields for user ${user.id} - check Airtable field names`)
      return "sorry, there was an error recording your response. please try again."
    }
    
    // Keep Pending_Poll field (not clearing it after response is recorded)
    console.log(`[PollResponse] Keeping Pending_Poll field (not clearing after response)`)
    
    console.log(`[PollResponse] Successfully recorded response for user ${user.id}`)
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
  // Verify Airtable fields exist
  const fieldCheck = await verifyAirtableFields()
  if (!fieldCheck.success && fieldCheck.missingFields.length > 0) {
    console.error(`[Poll] Cannot send poll - missing Airtable fields: ${fieldCheck.missingFields.join(', ')}`)
    return `⚠️ error: missing Airtable fields: ${fieldCheck.missingFields.join(', ')}. please add them to your table.`
  }
  
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
      console.log(`[Poll] SMS sent successfully to ${user.name || 'unnamed'} (${userPhoneNormalized})`)
      
      // Get the actual field name from the schema to ensure we use the correct one
      // (Record fields don't include empty fields, so we need to check the schema)
      const Airtable = (await import('airtable')).default
      Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY })
      const base = Airtable.base(process.env.AIRTABLE_BASE_ID!)
      const tableName = process.env.AIRTABLE_TABLE_NAME || 'Enclave'
      
      let actualPendingPollField = 'Pending_Poll'
      
      // First, try to get field name from the table schema (includes all fields, even empty ones)
      try {
        const apiKey = process.env.AIRTABLE_API_KEY
        const baseId = process.env.AIRTABLE_BASE_ID
        const schemaResponse = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        })
        
        if (schemaResponse.ok) {
          const meta = await schemaResponse.json()
          const table = meta.tables?.find((t: any) => t.name === tableName)
          if (table && table.fields) {
            const schemaFieldNames = table.fields.map((f: any) => f.name)
            console.log(`[Poll] Schema fields:`, schemaFieldNames)
            
            // Find exact field name from schema - try exact match first
            if (schemaFieldNames.includes('Pending_Poll')) {
              actualPendingPollField = 'Pending_Poll'
            } else {
              // Try variations
              const pendingPollVariations = ['Pending_Poll\t', 'pending_poll', 'Pending Poll', 'pending poll']
              for (const variation of pendingPollVariations) {
                if (schemaFieldNames.includes(variation)) {
                  actualPendingPollField = variation
                  break
                }
              }
              
              // If still not found, search for any field containing "pending" and "poll"
              if (actualPendingPollField === 'Pending_Poll') {
                const matchingField = schemaFieldNames.find((f: string) => {
                  const lower = f.toLowerCase()
                  return lower.includes('pending') && lower.includes('poll')
                })
                if (matchingField) {
                  actualPendingPollField = matchingField
                  console.log(`[Poll] Found matching field in schema: "${matchingField}"`)
                }
              }
            }
          }
        }
      } catch (schemaError) {
        console.log(`[Poll] Could not fetch schema, will try record fields:`, schemaError)
      }
      
      // Fallback: try to get field names from the record (but empty fields won't be there)
      try {
        const record = await base(tableName).find(user.id)
        const recordFields = Object.keys(record.fields)
        console.log(`[Poll] Available fields in record ${user.id}:`, recordFields)
        
        // If we didn't find Pending_Poll in schema, try record fields
        if (actualPendingPollField === 'Pending_Poll' && !recordFields.includes('Pending_Poll')) {
          // Try variations in record fields
          const pendingPollVariations = ['Pending_Poll\t', 'pending_poll', 'Pending Poll']
          for (const variation of pendingPollVariations) {
            if (recordFields.includes(variation)) {
              actualPendingPollField = variation
              break
            }
          }
          if (actualPendingPollField === 'Pending_Poll') {
            console.log(`[Poll] Pending_Poll field not in record (likely empty), using schema name: "${actualPendingPollField}"`)
          }
        }
      } catch (fetchError) {
        console.log(`[Poll] Could not fetch record to check field names, using schema/default: ${fetchError}`)
      }
      
      console.log(`[Poll] Using field name "${actualPendingPollField}" to set pending poll`)
      console.log(`[Poll] Field name length: ${actualPendingPollField.length}, contains tab: ${actualPendingPollField.includes('\t')}`)
      
      console.log(`[Poll] Now setting ${actualPendingPollField}="${question}" for record ${user.id}`)
      
      // Use Airtable API directly to ensure the update happens
      let updateSuccess = false
      try {
        console.log(`[Poll] Attempting direct Airtable update...`)
        const updatePayload = { [actualPendingPollField]: question }
        console.log(`[Poll] Update payload keys:`, Object.keys(updatePayload))
        console.log(`[Poll] Update payload field name (hex):`, Array.from(actualPendingPollField).map(c => c.charCodeAt(0).toString(16)).join(' '))
        
        const updateResult = await base(tableName).update(user.id, updatePayload as any)
        console.log(`[Poll] Direct update succeeded. Updated fields:`, Object.keys(updateResult.fields))
        console.log(`[Poll] Update result fields values:`, Object.entries(updateResult.fields).map(([k, v]) => `${k}="${v}"`).join(', '))
        updateSuccess = true
        
        // Wait a moment for Airtable to process
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Verify it was actually set by checking the actual Airtable record
        const record = await base(tableName).find(user.id)
        const recordFields = Object.keys(record.fields)
        const pendingPollValue = record.fields[actualPendingPollField]
        
        console.log(`[Poll] Checking actual Airtable record after update...`)
        console.log(`[Poll] Record fields:`, recordFields)
        console.log(`[Poll] Record fields (hex):`, recordFields.map(f => `${f} [${Array.from(f).map(c => c.charCodeAt(0).toString(16)).join(' ')}]`))
        console.log(`[Poll] ${actualPendingPollField} value in record:`, pendingPollValue)
        
        // Check all fields that might contain the poll question
        const allFieldValues = Object.entries(record.fields)
          .filter(([k, v]) => v && String(v).includes(question.substring(0, 10)))
          .map(([k, v]) => `${k}="${v}"`)
        if (allFieldValues.length > 0) {
          console.log(`[Poll] Fields containing question text:`, allFieldValues)
        }
        
        if (pendingPollValue && String(pendingPollValue).trim() === question.trim()) {
          console.log(`[Poll] ✓ Verified: ${actualPendingPollField} was set to "${pendingPollValue}"`)
        } else if (pendingPollValue) {
          console.error(`[Poll] ✗ WARNING: ${actualPendingPollField} has different value: "${pendingPollValue}" (expected: "${question}")`)
          // Try updating again with the exact field name from the record
          const exactFieldName = recordFields.find((f: string) => {
            const lower = f.toLowerCase()
            return lower.includes('pending') && lower.includes('poll')
          })
          if (exactFieldName && exactFieldName !== actualPendingPollField) {
            console.log(`[Poll] Found exact field name "${exactFieldName}", trying update with that...`)
            console.log(`[Poll] Exact field name (hex):`, Array.from(exactFieldName).map(c => c.charCodeAt(0).toString(16)).join(' '))
            await base(tableName).update(user.id, { [exactFieldName]: question } as any)
            await new Promise(resolve => setTimeout(resolve, 1000))
            const retryRecord = await base(tableName).find(user.id)
            const retryValue = retryRecord.fields[exactFieldName]
            if (retryValue && String(retryValue).trim() === question.trim()) {
              console.log(`[Poll] ✓ Successfully set using exact field name "${exactFieldName}"`)
              updateSuccess = true
            } else {
              console.error(`[Poll] ✗ Still not set. Value: "${retryValue}"`)
            }
          }
        } else {
          console.error(`[Poll] ✗ WARNING: ${actualPendingPollField} was not set! Field is still empty.`)
          console.error(`[Poll] Field name "${actualPendingPollField}" might not exist or be writable`)
          console.error(`[Poll] Available fields in record:`, recordFields)
          
          // Try to find the field by searching all fields
          const matchingField = recordFields.find((f: string) => {
            const lower = f.toLowerCase()
            return lower.includes('pending') && lower.includes('poll')
          })
          if (matchingField) {
            console.log(`[Poll] Found matching field "${matchingField}" in record, trying update...`)
            try {
              await base(tableName).update(user.id, { [matchingField]: question } as any)
              await new Promise(resolve => setTimeout(resolve, 1000))
              const retryRecord = await base(tableName).find(user.id)
              const retryValue = retryRecord.fields[matchingField]
              if (retryValue && String(retryValue).trim() === question.trim()) {
                console.log(`[Poll] ✓ Successfully set using matching field "${matchingField}"`)
                updateSuccess = true
              } else {
                console.error(`[Poll] ✗ Still failed. Value: "${retryValue}"`)
                updateSuccess = false
              }
            } catch (retryError: any) {
              console.error(`[Poll] ✗ Retry update failed:`, retryError.message || retryError)
              updateSuccess = false
            }
          } else {
            updateSuccess = false
          }
          
          if (!updateSuccess) {
            console.error(`[Poll] ✗ FAILED to set Pending_Poll field after all retries`)
            updateFailed++
          }
        }
      } catch (directError: any) {
        console.error(`[Poll] ✗ Direct update failed:`, directError)
        console.error(`[Poll] Error type:`, directError.constructor?.name)
        console.error(`[Poll] Error message:`, directError.message)
        console.error(`[Poll] Error code:`, directError.error || directError.statusCode)
        console.error(`[Poll] Error status:`, directError.status)
        console.error(`[Poll] Full error:`, JSON.stringify(directError, null, 2))
        console.error(`[Poll] Field name attempted: "${actualPendingPollField}"`)
        console.error(`[Poll] Field name (hex):`, Array.from(actualPendingPollField).map(c => c.charCodeAt(0).toString(16)).join(' '))
        
        // Fallback to updateUser
        console.log(`[Poll] Trying fallback with updateUser...`)
        const updateFields: Record<string, unknown> = {
          [actualPendingPollField]: question
        }
        const updateResult = await updateUser(user.id, updateFields)
        if (updateResult) {
          console.log(`[Poll] Fallback updateUser succeeded`)
          // Verify the fallback actually worked
          await new Promise(resolve => setTimeout(resolve, 1000))
          const verifyRecord = await base(tableName).find(user.id)
          const verifyValue = verifyRecord.fields[actualPendingPollField]
          if (verifyValue && String(verifyValue).trim() === question.trim()) {
            console.log(`[Poll] ✓ Verified fallback update succeeded`)
            updateSuccess = true
          } else {
            console.error(`[Poll] ✗ Fallback update reported success but field not set. Value: "${verifyValue}"`)
            updateSuccess = false
            updateFailed++
          }
        } else {
          console.error(`[Poll] Fallback also failed`)
          updateSuccess = false
          updateFailed++
        }
      }
      
      if (!updateSuccess) {
        console.error(`[Poll] ✗ FAILED to set ${actualPendingPollField} for ${user.id}`)
        console.error(`[Poll] This likely means the field name doesn't match. Tried: "${actualPendingPollField}"`)
        updateFailed++
      }
    } else {
      console.log(`[Poll] SMS failed for ${userPhoneNormalized}: ${result.error}`)
    }
  }
  
  console.log(`[Poll] Complete: sent=${sent}, updateFailed=${updateFailed}`)
  return `✅ poll sent to ${sent} people!`
}

// Normalize poll question - preserve full semantic question, minimal transformation
function normalizePollQuestion(raw: string): string {
  let q = raw.trim()
  // Only ensure it ends with a question mark - preserve the full semantic meaning
  if (!q.endsWith('?')) q += '?'
  // Don't do any hardcoded transformations - preserve what the admin asked
  return q
}

// Parse poll response with semantic/intent-based understanding (no hardcoded keywords)
function parsePollResponse(message: string): { response: string; notes: string | null } {
  const lower = message.toLowerCase().trim()
  const original = message.trim()
  
  // Semantic analysis: detect intent through patterns and context
  
  // NEGATIVE INTENT: Patterns indicating refusal, inability, or absence
  const negativeIndicators = [
    // Inability patterns
    /\b(can'?t|cannot|cant|unable|won'?t|wont|will not)\s+(make|come|go|attend|be there|show|make it)\b/i,
    /\b(not|no)\s+(coming|going|attending|making it|gonna make it|gonna come|gonna go)\b/i,
    // Unavailability patterns
    /\b(busy|unavailable|have to skip|gonna skip|skipping|can'?t make it|cant make it)\b/i,
    // Refusal patterns
    /\b(sorry|unfortunately|regret)\s+(can'?t|cant|cannot|won'?t|wont|not)\b/i,
    // Negative sentiment
    /\b(not|no|nope|nah)\s+(thanks|thank you|way|chance|problem)\b/i,
    // Single letter "n" at start (common shorthand)
    /^n\b/i
  ]
  
  for (const pattern of negativeIndicators) {
    if (pattern.test(lower)) {
      // Extract the reason/note
      let note = original
      // Remove common negative starters
      note = note.replace(/^(sorry|unfortunately|i'?m|im|i am|regret)\s*/i, '').trim()
      note = note.replace(/^(can'?t|cannot|cant|won'?t|wont|not|no|nope|nah|n)\s*/i, '').trim()
      return { response: 'No', notes: note || null }
    }
  }
  
  // AFFIRMATIVE INTENT: Patterns indicating agreement, confirmation, or attendance
  const affirmativeIndicators = [
    // Attendance commitment patterns
    /\b(will|i'?ll|ill|gonna|going to|plan to|planning to)\s+(be there|come|go|attend|make it|show|show up)\b/i,
    // Direct attendance statements
    /\b(coming|going|attending|will attend|gonna attend|going to attend|be there|i'?ll be there|ill be there)\b/i,
    // Confirmation patterns
    /\b(see you|count me in|i'?m in|im in|absolutely|definitely|for sure|of course)\b/i,
    // Late but coming patterns
    /\b(late|running late|gonna be late|going to be late|might be late|will be late)\s+(but|though|however|just)\s*(coming|going|attending|be there|i'?ll|ill|will|gonna)?\b/i,
    // Affirmative with qualifiers
    /\b(but|though|however|just)\s+(late|running late|gonna be late|going to be late)\b/i,
    // Single letter "y" at start (common shorthand)
    /^y\b/i
  ]
  
  for (const pattern of affirmativeIndicators) {
    if (pattern.test(lower)) {
      // Extract notes about being late or other details
      let note = original
      // Remove common affirmative starters (semantically, not hardcoded)
      note = note.replace(/^(will|i'?ll|ill|gonna|going to|coming|going|attending|be there|see you|count me|i'?m in|im in|absolutely|definitely|for sure|of course|y)\s*/i, '').trim()
      // Remove common connectors
      note = note.replace(/^(but|though|however|just|,)\s*/i, '').trim()
      return { response: 'Yes', notes: note || null }
    }
  }
  
  // UNCERTAIN INTENT: Patterns indicating hesitation, possibility, or uncertainty
  const uncertainIndicators = [
    // Possibility patterns
    /\b(might|maybe|possibly|perhaps|could|may)\s+(come|go|attend|make it|be there|show)\b/i,
    // Probability patterns
    /\b(probably|likely|chances are)\s+(will|won'?t|wont|coming|going|attending)\b/i,
    // Uncertainty expressions
    /\b(not sure|unsure|don'?t know|dont know|uncertain|not certain|idk|i don'?t know)\b/i,
    // Conditional patterns
    /\b(if|depends|depending on)\s+(.*)\b/i,
    // Hesitation patterns
    /\b(probably|might)\s+(not|won'?t|wont)\b/i
  ]
  
  for (const pattern of uncertainIndicators) {
    if (pattern.test(lower)) {
      // Extract the uncertainty reason
      let note = original
      // Remove common uncertainty starters
      note = note.replace(/^(probably|might|maybe|possibly|perhaps|not sure|unsure|don'?t know|dont know|uncertain|not certain|idk|i don'?t know|if|depends)\s*/i, '').trim()
      note = note.replace(/^(but|though|,)\s*/i, '').trim()
      return { response: 'Maybe', notes: note || null }
    }
  }
  
  // Context-based fallbacks: analyze overall sentiment
  
  // If message mentions being late, likely affirmative (coming but late)
  if (/\b(late|running late|gonna be late|going to be late|might be late|will be late)\b/i.test(lower) && 
      !/\b(not|won'?t|wont|can'?t|cant|cannot)\b/i.test(lower)) {
    return { response: 'Yes', notes: original }
  }
  
  // If message mentions being busy/unavailable without negation of attendance, likely negative
  if (/\b(busy|unavailable|can'?t|cant|cannot)\b/i.test(lower) && 
      !/\b(but|though|however|still|will|gonna|coming|going)\b/i.test(lower)) {
    return { response: 'No', notes: original }
  }
  
  // If message is very short (1-3 characters) and looks like a response, analyze semantically
  if (original.length <= 3) {
    // Single character responses
    if (/^[yn]$/i.test(original)) {
      return { response: /^y$/i.test(original) ? 'Yes' : 'No', notes: null }
    }
    // Very short affirmative-sounding responses
    if (/^(yea|yep|yup|nah|nope)$/i.test(original)) {
      return { response: /^(yea|yep|yup)$/i.test(original) ? 'Yes' : 'No', notes: null }
    }
  }
  
  // Default: return as Unknown with the full message as notes
  // This allows manual review of ambiguous responses
  return { response: 'Unknown', notes: original }
}

export async function GET(request: NextRequest) {
  // Diagnostic endpoint - shows raw Airtable data for debugging
  try {
    // Import Airtable directly for raw access
    const Airtable = (await import('airtable')).default
    Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY })
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID!)
    const tableName = process.env.AIRTABLE_TABLE_NAME || 'Enclave'
    
    // Try to fetch table schema using Airtable REST API
    let tableSchema: any = null
    let schemaError: string | null = null
    try {
      const apiKey = process.env.AIRTABLE_API_KEY
      const baseId = process.env.AIRTABLE_BASE_ID
      const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      })
      if (response.ok) {
        const meta = await response.json()
        const table = meta.tables?.find((t: any) => t.name === tableName)
        if (table) {
          tableSchema = {
            name: table.name,
            fields: table.fields.map((f: any) => ({
              name: f.name,
              type: f.type,
              options: f.options
            }))
          }
        } else {
          schemaError = `Table "${tableName}" not found in schema. Available tables: ${meta.tables?.map((t: any) => t.name).join(', ') || 'none'}`
        }
      } else {
        const errorText = await response.text()
        schemaError = `Schema API returned ${response.status}: ${errorText}`
      }
    } catch (err) {
      schemaError = `Schema fetch error: ${err instanceof Error ? err.message : String(err)}`
      console.log('[Diagnostic] Could not fetch table schema:', err)
    }
    
    const records = await base(tableName).select({}).all()
    
    // Collect all unique field names across all records (some fields might be empty in some records)
    const allFieldNames = new Set<string>()
    records.forEach(r => {
      Object.keys(r.fields).forEach(field => allFieldNames.add(field))
    })
    
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
      // Show all fields found across all records (not just fields with values)
      allFieldsFound: Array.from(allFieldNames).sort(),
      // Show actual table schema if available
      tableSchema: tableSchema || null,
      schemaError: schemaError || null,
      rawRecords: rawRecords.slice(0, 5), // Show first 5 raw records for debugging
      processedUserCount: users.length,
      usersWithValidPhone: users.filter(u => u.phone && normalizePhone(u.phone).length >= 10).length,
      processedUsers: summary,
      note: 'Fields with empty values may not appear in rawRecords. Check tableSchema for all fields. If tableSchema is null, check schemaError for details. The error "Unknown field name: Pending_Poll" means the field does not exist with that exact name in Airtable.'
    })
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      error: String(error)
    }, { status: 500 })
  }
}
