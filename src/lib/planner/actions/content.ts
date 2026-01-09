/**
 * Content Query Handler
 * Handles questions about organization content (events, meetings, etc.)
 */

import { ActionResult } from '../types'
import { applyPersonality, TEMPLATES } from '../personality'

const FALLBACK_KEYWORDS = ['the', 'and', 'for', 'are', 'what', 'when', 'where', 'how', 'who', 'why', 'can', 'does', 'will', 'about', 'with']

export interface ContentQueryInput {
  phone: string
  message: string
  userName: string | null
  // Function to search content (will be provided by main app)
  searchContent?: (query: string) => Promise<ContentResult[]>
  // Recent messages for context about what was just sent
  recentMessages?: Array<{
    direction: 'inbound' | 'outbound'
    text: string
    createdAt: Date
    meta?: { action?: string; draftContent?: string } | null
  }>
  // Function to search past announcements/polls
  searchPastActions?: () => Promise<Array<{
    type: 'announcement' | 'poll'
    content: string
    sentAt: Date
    sentBy: string
  }>>
}

export interface ContentResult {
  title: string
  body: string
  score: number
  dateStr?: string | null
  timeRef?: string | null
}

/**
 * Use LLM to detect if user is asking about past actions (announcements/polls)
 */
async function isAskingAboutPastActions(message: string): Promise<{
  isPastActionQuery: boolean
  reasoning: string
}> {
  if (!process.env.OPENAI_API_KEY) {
    return { isPastActionQuery: false, reasoning: 'No API key' }
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const systemPrompt = `Determine if the user is asking about PAST announcements, polls, or messages that were sent.

Examples of past action queries:
- "what announcements have been sent?"
- "show me recent polls"
- "what did you send out yesterday?"
- "list past announcements"
- "what polls are active?"

NOT past action queries:
- "when is the event?" (asking about event timing)
- "who's coming?" (asking about attendance)
- "what's happening tonight?" (asking about upcoming events)

Respond with JSON: { "isPastActionQuery": boolean, "reasoning": string }`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Is this asking about past actions? "${message}"` }
      ],
      temperature: 0.1,
      max_tokens: 100,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      return {
        isPastActionQuery: parsed.isPastActionQuery || false,
        reasoning: parsed.reasoning || 'LLM analysis'
      }
    }
  } catch (error) {
    console.error('[ContentQuery] Past action detection failed:', error)
  }

  return { isPastActionQuery: false, reasoning: 'Fallback' }
}

/**
 * Calculate next occurrence date for recurring events
 */
function getNextOccurrence(recurringPattern: string, today: Date): string | null {
  if (!recurringPattern || !recurringPattern.startsWith('recurring:')) return null
  
  const dayName = recurringPattern.replace('recurring:', '').toLowerCase()
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const targetDay = dayNames.indexOf(dayName)
  if (targetDay === -1) return null
  
  const todayDay = today.getDay()
  let daysUntil = targetDay - todayDay
  if (daysUntil <= 0) daysUntil += 7 // Next week if today or past
  
  const nextDate = new Date(today)
  nextDate.setDate(today.getDate() + daysUntil)
  return nextDate.toISOString().split('T')[0] // YYYY-MM-DD
}

/**
 * Detect query intent to filter results appropriately
 */
function detectQueryIntent(query: string): {
  wantsRecurring: boolean
  wantsEvents: boolean
  wantsGeneral: boolean
  wantsDefinition: boolean
} {
  const lower = query.toLowerCase()
  const recurringKeywords = ['recurring', 'weekly', 'every', 'regular', 'routine', 'repeated']
  const eventKeywords = ['event', 'upcoming', 'coming up', 'next', 'future', 'calendar', 'schedule']
  const definitionKeywords = ['what are', 'what is', 'what\'s', 'define', 'explain', 'tell me about']
  
  const wantsDefinition = definitionKeywords.some(kw => lower.includes(kw)) && !lower.includes('for') && !lower.includes('in')
  const wantsRecurring = recurringKeywords.some(kw => lower.includes(kw)) && !wantsDefinition
  const wantsEvents = eventKeywords.some(kw => lower.includes(kw))
  const wantsGeneral = !wantsRecurring && !wantsEvents && !wantsDefinition
  
  return { wantsRecurring, wantsEvents, wantsGeneral, wantsDefinition }
}

/**
 * Use LLM to filter and format relevant results
 */
async function filterAndFormatResultsWithLLM(
  query: string,
  allResults: Array<{ title: string; body: string; score: number; source?: 'content' | 'announcement' | 'poll'; sentDate?: Date; dateStr?: string | null; timeRef?: string | null }>
): Promise<string> {
  if (!process.env.OPENAI_API_KEY || allResults.length === 0) {
    return allResults[0]?.body || TEMPLATES.noResults()
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const todayDayName = dayNames[today.getDay()]
    
    // Detect query intent to filter results
    const intent = detectQueryIntent(query)
    
    // Filter results based on intent
    let filteredResults = allResults
    if (intent.wantsRecurring && !intent.wantsDefinition) {
      // Only show recurring items (dateStr starts with "recurring:") or announcements mentioning recurring
      filteredResults = allResults.filter(r => 
        r.dateStr?.startsWith('recurring:') || 
        (r.source === 'announcement' && r.body.toLowerCase().match(/\b(every|weekly|recurring|regular)\b/))
      )
      // If asking "what are recurring events" (definition), show actual recurring events, not just explanation
      if (filteredResults.length === 0 && allResults.some(r => r.dateStr?.startsWith('recurring:'))) {
        filteredResults = allResults.filter(r => r.dateStr?.startsWith('recurring:'))
      }
    } else if (intent.wantsEvents && !intent.wantsRecurring) {
      // Show events but exclude recurring (unless they're upcoming this week)
      filteredResults = allResults.filter(r => 
        !r.dateStr?.startsWith('recurring:')
      )
    } else if (intent.wantsDefinition && intent.wantsRecurring) {
      // "What are recurring events" - show actual recurring events from knowledge base
      filteredResults = allResults.filter(r => r.dateStr?.startsWith('recurring:'))
    }
    // If general query, show all results (already filteredResults = allResults)

    // Format results for LLM, including contextual information
    const formattedResults = filteredResults.map((r, idx) => {
      let resultText = `[${idx + 1}] ${r.source === 'announcement' ? '📢' : r.source === 'poll' ? '📊' : '📋'} ${r.title || 'Info'}\n${r.body}`
      
      // Add content type information
      const contentType = r.dateStr?.startsWith('recurring:') ? 'RECURRING' : 
                         r.dateStr && !r.dateStr.startsWith('recurring:') ? 'EVENT' : 
                         r.source === 'announcement' ? 'ANNOUNCEMENT' :
                         r.source === 'poll' ? 'POLL' : 'FACT'
      resultText += `\nType: ${contentType}`
      
      // Add next occurrence for recurring items
      if (r.dateStr?.startsWith('recurring:')) {
        const nextOccurrence = getNextOccurrence(r.dateStr, today)
        if (nextOccurrence) {
          const nextDate = new Date(nextOccurrence)
          const dayName = dayNames[nextDate.getDay()]
          const daysUntil = Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          let whenText = ''
          if (daysUntil === 0) whenText = ' (today)'
          else if (daysUntil === 1) whenText = ' (tomorrow)'
          else if (daysUntil === 2) whenText = ' (day after tomorrow)'
          else whenText = ` (in ${daysUntil} days, ${nextOccurrence})`
          resultText += `\nNext occurrence: ${dayName}${whenText}`
        }
      }
      
      // Add context about sent date for relative date parsing and correlate with recurring patterns
      if (r.sentDate && (r.source === 'announcement' || r.source === 'poll')) {
        const sentDate = r.sentDate instanceof Date ? r.sentDate : new Date(r.sentDate)
        // Use local date, not UTC, to avoid timezone issues
        const year = sentDate.getFullYear()
        const month = String(sentDate.getMonth() + 1).padStart(2, '0')
        const day = String(sentDate.getDate()).padStart(2, '0')
        const dateStr = `${year}-${month}-${day}`
        const sentDayName = dayNames[sentDate.getDay()]
        resultText += `\nNote: This was sent on ${dateStr} (${sentDayName}). When this mentions relative dates like "tomorrow", "tmr", "next week", calculate them relative to ${dateStr}, not today's date.`
        
        // Check if this announcement might be about a recurring event mentioned in other results
        const titleLower = r.title.toLowerCase()
        const bodyLower = r.body.toLowerCase()
        const mentionsRecurring = filteredResults.some(other => 
          other.dateStr?.startsWith('recurring:') && 
          (other.title?.toLowerCase().includes(titleLower) || titleLower.includes(other.title?.toLowerCase() || ''))
        )
        if (mentionsRecurring) {
          resultText += `\nWarning: This announcement may reference a recurring event. Cross-reference with recurring patterns in other results to determine the actual date.`
        }
      }
      
      return resultText
    }).join('\n\n')

    const systemPrompt = `You are a helpful assistant that answers questions using the provided search results. 

CRITICAL: If search results are provided, they ARE relevant to the query. DO NOT say "no information" or "I don't have that information" if results are provided. Use the information in the results to answer the question, even if it's incomplete.

RESULT PRIORITY:
- Results are already prioritized: Upcoming events > Recurring events > Facts/content > Past announcements
- Use information from higher priority results first, but you can combine information from multiple results

You must fact-check all dates and information against the actual data provided.

TODAY'S CONTEXT:
- Today is ${todayDayName}, ${todayStr}
- Use this to calculate relative dates and determine when recurring events occur next

CRITICAL: FACT-CHECKING RULES:
- ONLY use dates that are explicitly stated in the search results
- DO NOT make up or hallucinate dates
- If a date is not in the results, calculate it from the information provided
- When combining recurring patterns with announcements:
  * If an announcement says "active meeting is tmr" and was sent on Jan 6, that means Jan 7
  * If the knowledge base says "active meeting is every Wednesday" and today's context shows Jan 7 is a Wednesday, that confirms the last one was Jan 7
  * Calculate the NEXT occurrence from today's date: if today is after Jan 7, find the next Wednesday
  * If today is Tuesday Jan 9, and the last active meeting was Wednesday Jan 7, the next one is Wednesday Jan 14 (next week)

CONTENT TYPES:
- RECURRING: Events that repeat weekly (e.g., "every Wednesday", dateStr starts with "recurring:"). 
  * Use the "Next occurrence" calculation provided in the results
  * If multiple sources mention the same recurring event, use the most specific information
- EVENT: One-time events with specific dates (dateStr is a date like "2026-01-16"). Show the date from the results.
- ANNOUNCEMENT: Messages that were sent. Contains a "Sent: YYYY-MM-DD" date.
  * Relative dates in announcements (e.g., "tomorrow", "tmr") are calculated from the "Sent:" date, NOT today
  * If an announcement mentions a recurring event, combine it with the recurring pattern from the knowledge base
- POLL: Questions that were sent. Same date handling as announcements.
- FACT: General information from the knowledge base.

QUERY INTENT AWARENESS:
- If user asks "what are recurring events" (definition question), list the ACTUAL recurring events from the results with their patterns and next occurrence dates
- If user asks "when is [event name]" for a recurring event, state the pattern AND the next occurrence date
- If user asks about "recurring" or "weekly" events, ONLY include recurring items (Type: RECURRING) with next occurrences
- If user asks about "upcoming" or "coming up", include events AND recurring items (with next occurrences)
- If user asks generally, include ALL relevant information from any source

YOUR TASK:
1. If search results are provided, you MUST use them to answer the question. DO NOT say "no information available" if results exist.
2. Extract and present information from the results, even if incomplete:
   - If a fact says "Study Hall every Wednesday at 6:30 PM", present that information
   - If a fact says "AE Summons date is TBD", say "AE Summons date is TBD (to be determined)"
   - If time/location isn't mentioned, don't make it up, but do provide what IS available
3. For ALL events (recurring or one-time), ALWAYS include what information is available:
   - Date (specific date, recurrence pattern, or "TBD" if mentioned)
   - Time (if mentioned in results)
   - Location (if mentioned in results)
   - For recurring: state the pattern (e.g., "every Wednesday") AND calculate the next occurrence if possible
4. For recurring items, ALWAYS mention when the next occurrence will be if you can calculate it:
   * If today is Tuesday Jan 9 and the event is every Wednesday, next is Wednesday Jan 14
   * State it clearly: "every Wednesday, next is January 14"
   * If date is TBD, say "date is TBD (to be determined)"
5. When you see both a recurring pattern AND an announcement about a specific occurrence:
   * The announcement tells you when one specific instance happened (relative to its sent date)
   * Use that to determine the last occurrence date
   * Then calculate the next occurrence from today's date using the recurring pattern
   * Example: Announcement sent Jan 6 says "active meeting is tmr" → that's Jan 7. Pattern is every Wednesday. Today is Jan 9 (Tuesday). Last was Jan 7 (Wednesday). Next is Jan 14 (next Wednesday).
6. Combine relevant information from multiple results to provide complete answers
7. If a date is not in the results, calculate it from recurring patterns and today's date if possible
8. DO NOT make up dates that aren't in the results or can't be calculated
9. If information is incomplete (e.g., "TBD", no date mentioned), state what you know and note what's missing

IMPORTANT DATE HANDLING EXAMPLES:
- Example 1: Knowledge base says "Active Meeting every Wednesday" (recurring:wednesday), announcement sent Jan 6 says "active meeting is tmr"
  * Announcement sent Jan 6 (local date), "tmr" relative to Jan 6 = Jan 7
  * Check if Jan 7 is a Wednesday (it should be, based on recurring pattern)
  * If today is Jan 9 (Tuesday), calculate: last Wednesday was Jan 7, next Wednesday is Jan 14
  * Response MUST include: "Active Meeting every Wednesday at 8pm at Ash's (610 Levering Apt 201). Based on announcement from Jan 6, the last one was Jan 7. Next one is January 14 (next Wednesday)"
  
- Example 2: User asks "When is active meeting"
  * Find recurring pattern: "every Wednesday"
  * Find location/time from knowledge base or announcements: "8pm at Ash's (610 Levering Apt 201)"
  * Calculate next occurrence: If today is Jan 9 (Tuesday), next Wednesday is Jan 14
  * Response: "Active Meeting is every Wednesday at 8pm at Ash's (610 Levering Apt 201). Next one is January 14"
  
- CRITICAL: When you see BOTH a recurring pattern AND an announcement:
  * The recurring pattern tells you the frequency (every Wednesday)
  * The announcement tells you a specific occurrence date (calculated from its sent date + relative date)
  * Use LOCAL DATE from sent date (not UTC) - if sent on Jan 6 local time, use Jan 6, not Jan 7
  * You MUST cross-reference: if announcement says "tmr" and was sent Jan 6, that's Jan 7
  * Verify Jan 7 matches the recurring pattern (should be a Wednesday)
  * Then calculate next occurrence from TODAY's date using the recurring pattern
  * DO NOT just use the announcement date - use it to confirm the recurring pattern is correct
  
- RESPONSE FORMAT FOR EVENTS:
  * Always include: Event name, date/time, location (if available), recurrence pattern (if recurring), next occurrence (if recurring)
  * For recurring events, ALWAYS state both the pattern AND when the next one is
  * Example recurring: "Active Meeting every Wednesday at 8pm at Ash's (610 Levering Apt 201). Next is January 14"
  * Example one-time: "Ski Trip January 16-19, 2026"
  * When user asks "when is [recurring event]", respond with: "[Event] is every [day] at [time] at [location]. Next is [date]"
  
- CALCULATING NEXT OCCURRENCE:
  * If today is Tuesday Jan 9 and event is every Wednesday:
    - Calculate: Jan 9 (Tue) → Jan 10 (Wed) is tomorrow, but if today is past the event time, use next week
    - Next Wednesday after today = Jan 14
    - State clearly: "Next is January 14 (next Wednesday)"
  * Always calculate from TODAY's date using the recurring pattern, not from any announcement date
  
- Example 2: Knowledge base says "IM soccer games every Monday"
  * If today is Jan 9 (Tuesday), next Monday is Jan 12
  * Response: "IM soccer games every Monday. Next one is Jan 12"

- For announcements with relative dates: "Sent: 2026-01-06" and content says "event is tomorrow" = Jan 7

FORMATTING RULES:
- DO NOT use markdown formatting (no asterisks ** for bold, no markdown lists)
- Write plain text as if sending a text message
- Use simple dashes or numbers for lists if needed (e.g., "1. item" or "- item")
- Keep formatting minimal and natural`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Question: "${query}"\n\nSearch Results (${filteredResults.length} results found):\n${formattedResults}\n\nIMPORTANT: These search results were found for your query. Use the information in these results to answer the question. If results mention the topic (even partially), provide that information. Do not say "no information available" when results are provided.` }
      ],
      temperature: 0.3,
      max_tokens: 400
    })

    const content = response.choices[0]?.message?.content
    return content?.trim() || allResults[0]?.body || TEMPLATES.noResults()
  } catch (error) {
    console.error('[ContentQuery] LLM filtering failed:', error)
    // Fallback to top result
    return allResults[0]?.body || TEMPLATES.noResults()
  }
}

/**
 * Handle content query action
 * Searches both content database and past announcements/polls, then uses LLM to filter and format results.
 */
export async function handleContentQuery(input: ContentQueryInput): Promise<ActionResult> {
  const { phone, message, userName, searchContent, recentMessages, searchPastActions } = input
  
  console.log(`[ContentQuery] Processing query: "${message}"`)
  
  // Check if asking about recent actions first (highest priority)
  const recentActionResponse = checkRecentActions(message, recentMessages)
  if (recentActionResponse) {
    console.log(`[ContentQuery] Found recent action context`)
    return {
      action: 'content_query',
      response: applyPersonality({
        baseResponse: recentActionResponse,
        userMessage: message,
        userName
      })
    }
  }
  
  // Collect all results from both sources
  const allResults: Array<{ title: string; body: string; score: number; source?: 'content' | 'announcement' | 'poll'; sentDate?: Date; dateStr?: string | null; timeRef?: string | null }> = []
  
  // 1. Search content database (always try, even if it fails)
  if (searchContent) {
    console.log(`[ContentQuery] Searching content database...`)
    try {
      const contentResults = await searchContent(message)
      console.log(`[ContentQuery] Found ${contentResults.length} content results`)
      allResults.push(...contentResults.map(r => ({ 
        ...r, 
        source: 'content' as const,
        dateStr: r.dateStr || null,
        timeRef: r.timeRef || null
      })))
    } catch (error) {
      console.error('[ContentQuery] Content search failed:', error)
      // Continue even if content search fails - we still have announcements
    }
  }
  
  // 2. Search past announcements/polls (always search, not just for past action queries)
  if (searchPastActions) {
    console.log(`[ContentQuery] Searching past announcements/polls...`)
    try {
      const pastActions = await searchPastActions()
      console.log(`[ContentQuery] Found ${pastActions.length} past actions`)
      
      // Convert past actions to content results format
      // For general queries, include all past actions; for specific queries, filter by relevance
      const queryLower = message.toLowerCase()
      const isSpecificQuery = /\b(what|when|where|who|how)\b/.test(queryLower)
      
      let relevantActions = pastActions
      if (isSpecificQuery) {
        // For specific questions, filter by relevance
        relevantActions = pastActions.filter(action => {
          const contentLower = action.content.toLowerCase()
          const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2 && !FALLBACK_KEYWORDS.includes(w))
          return queryWords.length === 0 || queryWords.some(word => contentLower.includes(word))
        })
      }
      // For general queries, include all past actions (they're already sorted by recency)
      
      const mappedActions = relevantActions.map(action => {
      // Include sent date in the body for relative date parsing
      // Convert to local date to avoid timezone issues
      const sentDate = action.sentAt instanceof Date ? action.sentAt : new Date(action.sentAt)
      const year = sentDate.getFullYear()
      const month = String(sentDate.getMonth() + 1).padStart(2, '0')
      const day = String(sentDate.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}` // Local date, not UTC
      return {
        title: action.type === 'poll' ? 'Poll' : 'Announcement',
        body: `${action.type === 'poll' ? '📊' : '📢'} ${action.content}${action.type === 'poll' ? '\n(Reply yes/no/maybe)' : ''}\n(Sent: ${dateStr})`,
        score: 0.5, // Medium relevance for past actions
        source: action.type === 'poll' ? 'poll' as const : 'announcement' as const,
        sentDate: new Date(year, sentDate.getMonth(), sentDate.getDate()) // Store local date for LLM context
      }
        })
      
      allResults.push(...mappedActions)
      console.log(`[ContentQuery] Found ${mappedActions.length} relevant past actions`)
    } catch (error) {
      console.error('[ContentQuery] Past actions search failed:', error)
    }
  }
  
  // Sort all results by priority: upcoming events -> recurring -> facts -> past announcements
  // Within each group, sort by score
  allResults.sort((a, b) => {
    // Priority order: upcoming events (has dateStr but not recurring) > recurring > facts/content > announcements/polls
    const getPriority = (r: typeof allResults[0]): number => {
      if (r.dateStr && !r.dateStr.startsWith('recurring:') && r.source === 'content') {
        // Upcoming event - check if date is in the future
        try {
          const eventDate = new Date(r.dateStr)
          if (eventDate >= new Date()) return 4 // Highest priority for future events
        } catch (e) {
          // Invalid date, treat as fact
        }
      }
      if (r.dateStr?.startsWith('recurring:') && r.source === 'content') return 3 // Recurring events
      if (r.source === 'content') return 2 // Facts/general content
      if (r.source === 'announcement' || r.source === 'poll') return 1 // Past announcements (lowest priority)
      return 0
    }
    
    const priorityA = getPriority(a)
    const priorityB = getPriority(b)
    
    if (priorityA !== priorityB) {
      return priorityB - priorityA // Higher priority first
    }
    
    // Same priority, sort by score
    return b.score - a.score
  })
  
  // If no results, return no results message
  if (allResults.length === 0) {
    return {
      action: 'content_query',
      response: applyPersonality({
        baseResponse: TEMPLATES.noResults(),
        userMessage: message,
        userName
      })
    }
  }
  
  // Use LLM to filter and format the most relevant results
  console.log(`[ContentQuery] Filtering and formatting ${allResults.length} results with LLM...`)
  const formattedResponse = await filterAndFormatResultsWithLLM(message, allResults)
  console.log(`[ContentQuery] Result: ${formattedResponse.substring(0, 50)}...`)
  
  return {
    action: 'content_query',
    response: applyPersonality({
      baseResponse: formattedResponse,
      userMessage: message,
      userName
    })
  }
}

/**
 * Check if the query is asking about recent actions
 */
function checkRecentActions(
  message: string, 
  recentMessages?: Array<{
    direction: 'inbound' | 'outbound'
    text: string
    createdAt: Date
    meta?: { action?: string; draftContent?: string } | null
  }>
): string | null {
  if (!recentMessages || recentMessages.length === 0) return null
  
  const lower = message.toLowerCase()
  const isAskingAboutSent = /\b(what did|what have) (you|i) (just )?(send|sent|say|said|announce|do|did)\b/i.test(lower)
  const isAskingAboutAnnouncement = /\bwhat (was|is) (that|the) (announcement|message|poll)\b/i.test(lower)
  
  if (!isAskingAboutSent && !isAskingAboutAnnouncement) return null
  
  // Look for recent draft_send actions in the last few messages
  for (let i = recentMessages.length - 1; i >= Math.max(0, recentMessages.length - 5); i--) {
    const msg = recentMessages[i]
    
    // Check if this was a draft_send action
    if (msg.meta?.action === 'draft_send' && msg.direction === 'outbound') {
      // Look back to find what was sent - check for the actual announcement/poll content
      // It should be in an earlier message with draft_write action or in the meta
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const prevMsg = recentMessages[j]
        
        // Look for the draft preview message
        if (prevMsg.direction === 'outbound' && prevMsg.text.includes('here\'s the')) {
          // Extract the content between quotes
          const match = prevMsg.text.match(/"([^"]+)"/);
          if (match && match[1]) {
            return `i just sent out: "${match[1]}"`
          }
        }
        
        // Or look for draft_write with content in meta
        if (prevMsg.meta?.draftContent) {
          return `i just sent out: "${prevMsg.meta.draftContent}"`
        }
      }
      
      // Fallback - just tell them something was sent
      return `i just sent out an announcement. check your messages`
    }
  }
  
  return null
}

/**
 * Format content result into a response
 */
function formatContentResponse(result: ContentResult, query: string): string {
  const { title, body } = result
  
  // Clean the body by removing excessive emojis and formatting
  let cleanedBody = body
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Remove emojis
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
  
  // If body is short, return it directly
  if (cleanedBody.length < 200) {
    return cleanedBody
  }
  
  // Try to extract the most relevant part
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  
  // Find sentence containing query words
  const sentences = cleanedBody.split(/[.!?]+/).filter(s => s.trim().length > 10)
  
  for (const word of queryWords) {
    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes(word)) {
        return sentence.trim() + '.'
      }
    }
  }
  
  // Fallback: return first 200 chars
  return cleanedBody.substring(0, 200) + '...'
}

/**
 * Determine if a query is vague/broad and would benefit from a summary.
 */
function isVagueQuery(message: string): boolean {
  const lower = message.toLowerCase()
  const vagueStarters = /(what is|tell me about|give me info on|what's|whats|who is|summarize|overview)/i
  const words = lower.split(/\s+/).filter(Boolean)
  const keywordCount = words.filter(w => w.length > 3).length
  return vagueStarters.test(lower) || keywordCount <= 3
}

/**
 * Summarize multiple results into a concise bullet response.
 */
function summarizeResults(results: ContentResult[]): string {
  const bullets = results.map(r => `• ${r.body}`).join('\n')
  return `here's the quick rundown:\n${bullets}`
}

/**
 * Quick answers for common questions (no search needed)
 */
export function getQuickContentAnswer(message: string): string | null {
  const lower = message.toLowerCase()
  
  // These would be populated from actual data in production
  // For now, return null to indicate no quick answer available
  
  // Example pattern for future:
  // if (/when is (the |next )?active( meeting)?/i.test(lower)) {
  //   return "Active meeting is every Wednesday at 8pm"
  // }
  
  return null
}

