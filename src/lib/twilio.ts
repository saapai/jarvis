import twilio from 'twilio'

let _twilioClient: ReturnType<typeof twilio> | null = null

function getTwilioClient() {
  if (!_twilioClient) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    
    if (!accountSid || !authToken) {
      throw new Error('Missing Twilio environment variables')
    }
    
    _twilioClient = twilio(accountSid, authToken)
  }
  return _twilioClient
}

// Validate Twilio webhook signature
export async function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN || ''
  return twilio.validateRequest(authToken, signature, url, params)
}

// Send SMS/MMS via Twilio
export async function sendSms(to: string, body: string, mediaUrls?: string[]): Promise<{ ok: boolean; sid?: string; error?: string }> {
  try {
    const client = getTwilioClient()
    const fromNumber = process.env.TWILIO_PHONE_NUMBER || ''
    const params: any = {
      body,
      from: fromNumber,
      to: to.startsWith('+') ? to : `+1${to}`
    }
    if (mediaUrls && mediaUrls.length > 0) {
      // Twilio supports up to 10 media URLs per MMS
      params.mediaUrl = mediaUrls.slice(0, 10)
    }
    const message = await client.messages.create(params)
    return { ok: true, sid: message.sid }
  } catch (error) {
    console.error('Failed to send SMS:', error)
    return { ok: false, error: String(error) }
  }
}

// Generate TwiML response
// Break a reply into a few SHORT texts instead of one long one — each chunk aims for
// ~`target` chars and only splits at natural boundaries (blank lines, list items,
// sentence ends). Never breaks a word or a URL: a line containing a link stays whole
// even if it's a little long. A short reply passes through as a single message.
function chunkMessage(text: string, target = 320): string[] {
  const trimmed = (text || '').trim()
  if (trimmed.length <= target) return [trimmed]

  const chunks: string[] = []
  let cur = ''
  const flush = () => { if (cur.trim()) chunks.push(cur.trim()); cur = '' }

  for (const line of trimmed.split('\n')) {
    // Whole line fits onto the current chunk (preserving the line break)? add it.
    const withLine = cur ? `${cur}\n${line}` : line
    if (withLine.length <= target) { cur = withLine; continue }

    // It doesn't fit — flush what we have and place the line.
    flush()
    if (line.length <= target) { cur = line; continue }

    // The line itself is too long: word-wrap it at spaces. Words (incl. whole URLs)
    // are atomic — never split mid-token — so links stay clickable. A lone token that
    // exceeds target becomes its own (over-length) chunk rather than getting broken.
    let buf = ''
    for (const word of line.split(' ')) {
      if (buf && `${buf} ${word}`.length > target) { chunks.push(buf.trim()); buf = word }
      else buf = buf ? `${buf} ${word}` : word
    }
    cur = buf // leftover carries forward so the next line can pack onto it
  }
  flush()
  return chunks.filter(Boolean)
}

export function toTwiml(messages: string[]): string {
  // First break into short chunks (~320), then apply the hard SMS-segment cap as a backstop.
  const allMessages = messages.flatMap(msg => chunkMessage(msg, 320)).flatMap(m => splitLongMessage(m, 1600))
  
  if (allMessages.length === 1) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(allMessages[0])}</Message>
</Response>`
  }
  
  const messageXml = allMessages
    .map(msg => `  <Message>${escapeXml(msg)}</Message>`)
    .join('\n')
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${messageXml}
</Response>`
}

// Split long messages at sentence boundaries
function splitLongMessage(message: string, maxLength = 1600): string[] {
  if (message.length <= maxLength) return [message]
  
  const result: string[] = []
  let remaining = message
  
  while (remaining.length > maxLength) {
    const searchText = remaining.substring(0, maxLength)
    
    const lastPeriod = searchText.lastIndexOf('. ')
    const lastQuestion = searchText.lastIndexOf('? ')
    const lastExclaim = searchText.lastIndexOf('! ')
    const lastNewline = searchText.lastIndexOf('\n')
    
    const boundaries = [lastPeriod, lastQuestion, lastExclaim, lastNewline]
      .filter(b => b >= maxLength * 0.5)
    
    const splitAt = boundaries.length > 0 
      ? Math.max(...boundaries) + 1 
      : maxLength
    
    result.push(remaining.substring(0, splitAt).trim())
    remaining = remaining.substring(splitAt).trim()
  }
  
  if (remaining) {
    result.push(remaining)
  }
  
  return result
}

// Escape XML special characters
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
