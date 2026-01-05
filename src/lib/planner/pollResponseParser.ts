/**
 * Poll Response Parser
 * Parses user responses to poll questions using LLM for better context understanding
 */

export interface ParsedPollResponse {
  response: 'Yes' | 'No' | 'Maybe'
  notes: string | null
}

/**
 * Parse poll response from user message using LLM
 * Falls back to simple pattern matching if LLM unavailable
 */
export async function parsePollResponse(message: string): Promise<ParsedPollResponse> {
  // Try LLM parsing first for better context understanding
  if (process.env.OPENAI_API_KEY) {
    try {
      const OpenAI = (await import('openai')).default
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      
      const systemPrompt = `You are parsing poll responses. Classify the response as Yes/No/Maybe and extract any notes.

RULES:
- Yes: Affirmative, attending, agreeing (even with caveats like "yes but late")
- No: Negative, declining, can't make it, unavailable
- Maybe: Uncertain, depends, not sure, possibly

- Extract notes: Any additional context like "running late", "need to leave early", "if I finish work"
- If the response is ONLY yes/no/maybe with no context, notes should be null

Examples:
- "yes but running late" → Yes, notes: "running late"
- "can't make it, busy" → No, notes: "busy"
- "maybe if I finish work" → Maybe, notes: "if I finish work"
- "y" → Yes, notes: null
- "nah" → No, notes: null`

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Parse this poll response: "${message}"` }
        ],
        temperature: 0.1,
        max_tokens: 100,
        response_format: { type: 'json_object' }
      })
      
      const content = completion.choices[0].message.content
      if (content) {
        const parsed = JSON.parse(content)
        const response = parsed.response as 'Yes' | 'No' | 'Maybe'
        const notes = parsed.notes || null
        
        console.log(`[PollParser] LLM parsed "${message}" → ${response}${notes ? `, notes: "${notes}"` : ''}`)
        return { response, notes }
      }
    } catch (error) {
      console.error('[PollParser] LLM parsing failed, using fallback:', error)
    }
  }
  
  // Fallback to simple pattern matching
  return parsePollResponseSimple(message)
}

/**
 * Simple pattern-based fallback parser
 */
function parsePollResponseSimple(message: string): ParsedPollResponse {
  const lower = message.toLowerCase().trim()
  
  // Simple yes/no detection
  if (/^(y|yes|yep|yup|yeah|yea|sure|ok|okay)$/i.test(lower)) {
    return { response: 'Yes', notes: null }
  }
  
  if (/^(n|no|nah|nope)$/i.test(lower)) {
    return { response: 'No', notes: null }
  }
  
  if (/^(maybe|perhaps|possibly|idk|not sure)$/i.test(lower)) {
    return { response: 'Maybe', notes: null }
  }
  
  // Check for negative words
  if (/\b(can'?t|cannot|won'?t|no|nope|busy|unavailable)\b/i.test(lower)) {
    return { response: 'No', notes: message.trim() }
  }
  
  // Check for affirmative words
  if (/\b(yes|yep|coming|going|i'?ll be there|count me in)\b/i.test(lower)) {
    return { response: 'Yes', notes: message.trim() }
  }
  
  // Default to Maybe with full message as notes
  return { response: 'Maybe', notes: message.trim() }
}
