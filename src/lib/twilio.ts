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

// Send SMS via Twilio
export async function sendSms(to: string, body: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  try {
    const client = getTwilioClient()
    const fromNumber = process.env.TWILIO_PHONE_NUMBER || ''
    const message = await client.messages.create({
      body,
      from: fromNumber,
      to: to.startsWith('+') ? to : `+1${to}`
    })
    return { ok: true, sid: message.sid }
  } catch (error) {
    console.error('Failed to send SMS:', error)
    return { ok: false, error: String(error) }
  }
}

// Generate TwiML response
export function toTwiml(messages: string[]): string {
  const allMessages = messages.flatMap(msg => splitLongMessage(msg, 1600))
  
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
