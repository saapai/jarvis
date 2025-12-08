/**
 * Poll Response Parser
 * Parses user responses to poll questions
 */

export interface ParsedPollResponse {
  response: 'Yes' | 'No' | 'Maybe'
  notes: string | null
}

/**
 * Parse poll response from user message
 * Uses semantic patterns to understand intent
 */
export function parsePollResponse(message: string): ParsedPollResponse {
  const lower = message.toLowerCase().trim()
  const original = message.trim()
  
  // NEGATIVE INTENT: Patterns indicating refusal, inability, or absence
  const negativeIndicators = [
    /\b(can'?t|cannot|cant|unable|won'?t|wont|will not)\s+(make|come|go|attend|be there|show|make it)\b/i,
    /\b(not|no)\s+(coming|going|attending|making it|gonna make it|gonna come|gonna go)\b/i,
    /\b(busy|unavailable|have to skip|gonna skip|skipping|can'?t make it|cant make it)\b/i,
    /\b(sorry|unfortunately|regret)\s+(can'?t|cant|cannot|won'?t|wont|not)\b/i,
    /\b(not|no|nope|nah)\s+(thanks|thank you|way|chance|problem)\b/i,
    /^n\b/i
  ]
  
  for (const pattern of negativeIndicators) {
    if (pattern.test(lower)) {
      // Extract the reason/note
      let note = original
      note = note.replace(/^(sorry|unfortunately|i'?m|im|i am|regret)\s*/i, '').trim()
      note = note.replace(/^(can'?t|cannot|cant|won'?t|wont|not|no|nope|nah|n)\s*/i, '').trim()
      return { response: 'No', notes: note || null }
    }
  }
  
  // AFFIRMATIVE INTENT: Patterns indicating agreement, confirmation, or attendance
  const affirmativeIndicators = [
    /\b(will|i'?ll|ill|gonna|going to|plan to|planning to)\s+(be there|come|go|attend|make it|show|show up)\b/i,
    /\b(coming|going|attending|will attend|gonna attend|going to attend|be there|i'?ll be there|ill be there)\b/i,
    /\b(see you|count me in|i'?m in|im in|absolutely|definitely|for sure|of course)\b/i,
    /\b(late|running late|gonna be late|going to be late|might be late|will be late)\s+(but|though|however|just)\s*(coming|going|attending|be there|i'?ll|ill|will|gonna)?\b/i,
    /\b(but|though|however|just)\s+(late|running late|gonna be late|going to be late)\b/i,
    /^y\b/i
  ]
  
  for (const pattern of affirmativeIndicators) {
    if (pattern.test(lower)) {
      // Extract notes about being late or other details
      let note = original
      note = note.replace(/^(will|i'?ll|ill|gonna|going to|coming|going|attending|be there|see you|count me|i'?m in|im in|absolutely|definitely|for sure|of course|y)\s*/i, '').trim()
      note = note.replace(/^(but|though|however|just|,)\s*/i, '').trim()
      return { response: 'Yes', notes: note || null }
    }
  }
  
  // UNCERTAIN INTENT: Patterns indicating hesitation, possibility, or uncertainty
  const uncertainIndicators = [
    /\b(might|maybe|possibly|perhaps|could|may)\s+(come|go|attend|make it|be there|show)\b/i,
    /\b(probably|likely|chances are)\s+(will|won'?t|wont|coming|going|attending)\b/i,
    /\b(not sure|unsure|don'?t know|dont know|uncertain|not certain|idk|i don'?t know)\b/i,
    /\b(if|depends|depending on)\s+(.*)\b/i,
    /\b(probably|might)\s+(not|won'?t|wont)\b/i
  ]
  
  for (const pattern of uncertainIndicators) {
    if (pattern.test(lower)) {
      // Extract the uncertainty reason
      let note = original
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
  
  // If message is very short (1-3 characters) and looks like a response
  if (original.length <= 3) {
    if (/^[yn]$/i.test(original)) {
      return { response: /^y$/i.test(original) ? 'Yes' : 'No', notes: null }
    }
    if (/^(yea|yep|yup|nah|nope)$/i.test(original)) {
      return { response: /^(yea|yep|yup)$/i.test(original) ? 'Yes' : 'No', notes: null }
    }
  }
  
  // Default: return as Maybe with the full message as notes
  return { response: 'Maybe', notes: original }
}
