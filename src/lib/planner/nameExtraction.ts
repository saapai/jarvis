/**
 * Name extraction for onboarding. Standalone (not route-coupled) so it's directly
 * testable — a wrong extraction here poisons a member's stored name permanently.
 */

import { TEXTER_MODEL } from './models'

export async function extractName(message: string): Promise<string | null> {
  const text = message.trim()

  // Mechanical bounds only — too short/long to be a name. Everything else (is this a
  // question? a greeting? a command?) is the LLM's judgment, per the prompt below.
  if (text.length > 100 || text.length < 2) return null
  if (!process.env.OPENAI_API_KEY) return null

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const response = await openai.chat.completions.create({
      model: TEXTER_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are onboarding a new member by SMS and need their NAME. Decide if this message gives one.

Return ONLY the person's name if one is clearly present, else "NOT_A_NAME".
- Any ethnicity/format; names are 1-3 words.
- Strip conversational prefixes: "I'm Sarah" → "Sarah", "my name is John" → "John", "call me Mike" → "Mike", "no im saathvik" → "Saathvik".
- CRITICAL: a question or command is NEVER a name, even if it contains a word that could be one. "When is summons" → NOT_A_NAME (it's a question about an event, not someone named Summons). "what is sep" → NOT_A_NAME. "when is ski trip" → NOT_A_NAME. "announce the meeting" → NOT_A_NAME.
- Greetings/chatter → NOT_A_NAME: "yo what up", "hi there", "sup".
- "call me X" / "I'm X" / "this is X" / "it's X" ARE clear name introductions — extract X. The imperative "call" here means "address me as", it is NOT a command to reject.
- When a message is a QUESTION or an event/command reference, prefer NOT_A_NAME — storing a wrong name is worse than asking again. This caution is about questions, not about clear name introductions.

Return format: Just the name (capitalized properly) or "NOT_A_NAME"`
        },
        {
          role: 'user',
          content: `Message: "${text}"\n\nExtract the name or return NOT_A_NAME:`
        }
      ],
      temperature: 0,
      max_tokens: 20
    })

    const result = response.choices[0]?.message?.content?.trim() || null
    if (!result || result === 'NOT_A_NAME' || result.toLowerCase() === 'not a name') {
      return null
    }

    const cleaned = result.replace(/[!.?,;:]+$/, '').trim()
    if (cleaned.length < 2 || cleaned.length > 50) return null

    // A real name is 1-3 alphabetic tokens (hyphens/apostrophes allowed). Reject
    // digits/symbols or too many words so a stray phrase can't poison it.
    const tokens = cleaned.split(/\s+/)
    if (tokens.length > 3) return null
    if (!tokens.every(t => /^[a-zA-Z][a-zA-Z'’-]*$/.test(t))) return null

    return tokens
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  } catch (error) {
    console.error('[extractName] LLM error:', error)
    return null
  }
}
