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
    
    // Now clear Pending_Poll separately - use empty string (Airtable text fields should be cleared with '', not null)
    console.log(`[PollResponse] Attempting to clear ${actualPendingPollField}`)
    
    // Try direct Airtable update first (more reliable than updateUser for clearing)
    let clearResult = false
    try {
      console.log(`[PollResponse] Trying direct Airtable update with empty string...`)
      const directUpdate = await base(tableName).update(user.id, { [actualPendingPollField]: '' } as any)
      console.log(`[PollResponse] Direct update succeeded. Updated fields:`, Object.keys(directUpdate.fields))
      clearResult = true
    } catch (directError: any) {
      console.error(`[PollResponse] Direct update failed:`, directError.message || directError)
      // Fallback to updateUser
      console.log(`[PollResponse] Trying updateUser as fallback...`)
      clearResult = await updateUser(user.id, { [actualPendingPollField]: '' })
      if (!clearResult) {
        console.log(`[PollResponse] updateUser also failed, trying null...`)
        clearResult = await updateUser(user.id, { [actualPendingPollField]: null })
      }
    }
    
    // Wait a moment for Airtable to process the update
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Verify the field was actually cleared by checking the actual Airtable record
    // Note: Airtable doesn't return empty fields, so if the field is not in the response, it's cleared
    try {
      const record = await base(tableName).find(user.id)
      const recordFields = Object.keys(record.fields)
      const pendingPollValue = record.fields[actualPendingPollField]
      
      console.log(`[PollResponse] Checking actual Airtable record...`)
      console.log(`[PollResponse] Record fields:`, recordFields)
      console.log(`[PollResponse] Pending_Poll value in record:`, pendingPollValue)
      
      // If the field is not in recordFields, it means it's empty (Airtable doesn't return empty fields)
      // If it is in recordFields but has a value, that's a problem
      if (recordFields.includes(actualPendingPollField) && pendingPollValue && String(pendingPollValue).trim() !== '') {
        console.error(`[PollResponse] WARNING: Pending_Poll still has value: "${pendingPollValue}"`)
        console.error(`[PollResponse] Field name used: "${actualPendingPollField}"`)
        console.error(`[PollResponse] Clear result: ${clearResult}`)
        
        // Try one more time with direct update
        console.log(`[PollResponse] Retrying direct update with empty string...`)
        try {
          await base(tableName).update(user.id, { [actualPendingPollField]: '' } as any)
          await new Promise(resolve => setTimeout(resolve, 500))
          const finalRecord = await base(tableName).find(user.id)
          const finalValue = finalRecord.fields[actualPendingPollField]
          if (finalValue && String(finalValue).trim() !== '') {
            console.error(`[PollResponse] Still not cleared after retry. Final value: "${finalValue}"`)
            console.error(`[PollResponse] This may be an Airtable API limitation - field may need manual clearing`)
          } else {
            console.log(`[PollResponse] Successfully cleared with retry`)
          }
        } catch (retryError) {
          console.error(`[PollResponse] Retry also failed:`, retryError)
        }
      } else {
        // Field is either not in recordFields (empty) or has empty value - both mean it's cleared
        console.log(`[PollResponse] Verified: Pending_Poll was successfully cleared`)
        if (recordFields.includes(actualPendingPollField)) {
          console.log(`[PollResponse] Field exists but is empty: "${pendingPollValue}"`)
        } else {
          console.log(`[PollResponse] Field not in response (Airtable doesn't return empty fields)`)
        }
      }
    } catch (verifyError) {
      console.error(`[PollResponse] Could not verify:`, verifyError)
      // Fallback to our user check
      const updatedUser = await getUserByPhone(phone)
      if (updatedUser && updatedUser.pending_poll) {
        console.error(`[PollResponse] WARNING: Pending_Poll still has value: "${updatedUser.pending_poll}"`)
      } else {
        console.log(`[PollResponse] Verified via getUserByPhone: Pending_Poll appears cleared`)
      }
    }
    
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
