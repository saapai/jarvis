/**
 * Content Query Handler
 * Handles questions about organization content (events, meetings, etc.)
 * Uses a generalizable category-based system for organizing and querying content
 */

import { ActionResult } from '../types'
import { applyPersonality, TEMPLATES } from '../personality'

const FALLBACK_KEYWORDS = ['the', 'and', 'for', 'are', 'what', 'when', 'where', 'how', 'who', 'why', 'can', 'does', 'will', 'about', 'with']

export type ContentCategory = 'upcoming' | 'recurring' | 'past' | 'facts' | 'announcements' | 'polls'

export interface ContentQueryInput {
  phone: string
  message: string
  userName: string | null
  // Function to search content (will be provided by main app)
  searchContent?: (query: string) => Promise<ContentResult[]>
  // Function to search events (from Event table)
  searchEvents?: () => Promise<EventResult[]>
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
  category?: ContentCategory
  eventDate?: Date
}

export interface EventResult {
  id: string
  title: string
  description: string | null
  eventDate: Date
  location: string | null
  category: string | null
  linkedFactId: string | null
}

/**
 * Category metadata configuration
 */
const CATEGORY_CONFIG: Record<ContentCategory, {
  keywords: string[]
  timeDirection: 'future' | 'past' | 'none'
  priority: number
}> = {
  upcoming: {
    keywords: ['upcoming', 'coming up', 'next', 'future', 'soon', 'this week', 'tonight', 'tomorrow', 'calendar', 'schedule'],
    timeDirection: 'future',
    priority: 4
  },
  recurring: {
    keywords: ['recurring', 'weekly', 'every', 'regular', 'routine', 'repeated', 'repeats'],
    timeDirection: 'future',
    priority: 3
  },
  past: {
    keywords: ['past', 'previous', 'last', 'ago', 'yesterday', 'last week', 'last month', 'was', 'were', 'happened'],
    timeDirection: 'past',
    priority: 2
  },
  facts: {
    keywords: ['fact', 'info', 'information', 'about', 'tell me'],
    timeDirection: 'none',
    priority: 2
  },
  announcements: {
    keywords: ['announcement', 'announce', 'sent out', 'sent', 'broadcast', 'message'],
    timeDirection: 'past',
    priority: 1
  },
  polls: {
    keywords: ['poll', 'survey', 'vote', 'voting', 'response'],
    timeDirection: 'past',
    priority: 1
  }
}

/**
 * Detect which categories a query is asking about
 * Returns categories that should be included in results
 */
async function detectQueryCategories(message: string): Promise<{
  categories: ContentCategory[]
  reasoning: string
}> {
  if (!process.env.OPENAI_API_KEY) {
    // Fallback to keyword-based detection
    return detectQueryCategoriesByKeywords(message)
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const categoryDescriptions = Object.entries(CATEGORY_CONFIG).map(([cat, config]) => 
      `- ${cat}: ${config.keywords.slice(0, 3).join(', ')} (${config.timeDirection} dates)`
    ).join('\n')

    const systemPrompt = `Determine which content categories the user is asking about. Categories:

${categoryDescriptions}

Examples:
- "what are recurring events?" → categories: ["recurring"]
- "what's on my calendar?" → categories: ["upcoming", "recurring", "announcements", "polls"] (meta query - aggregate all)
- "what are past announcements?" → categories: ["announcements"]
- "when is active meeting?" → categories: ["upcoming", "recurring", "facts"] (general future event query - include both upcoming and recurring)
- "what events are coming up?" → categories: ["upcoming", "recurring"] (general future event query - include both)
- "tell me about study hall" → categories: ["upcoming", "recurring", "past", "facts"] (general query)
- Any question about future events without specific category → include both ["upcoming", "recurring"]

Respond with JSON: { "categories": string[], "reasoning": string }
Categories should be one of: upcoming, recurring, past, facts, announcements, polls`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `What categories is this query asking about? "${message}"` }
      ],
      temperature: 0.1,
      max_tokens: 150,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      const categories = (parsed.categories || []).filter((cat: string) => 
        Object.keys(CATEGORY_CONFIG).includes(cat)
      ) as ContentCategory[]
      return {
        categories: categories.length > 0 ? categories : ['upcoming', 'recurring', 'facts', 'announcements', 'polls'],
        reasoning: parsed.reasoning || 'LLM analysis'
      }
    }
  } catch (error) {
    console.error('[ContentQuery] Category detection failed:', error)
  }

  return detectQueryCategoriesByKeywords(message)
}

/**
 * Fallback keyword-based category detection
 */
function detectQueryCategoriesByKeywords(message: string): {
  categories: ContentCategory[]
  reasoning: string
} {
  const lower = message.toLowerCase()
  const categories: ContentCategory[] = []

  // Check for general future event queries (should include both upcoming and recurring)
  const futureEventKeywords = ['coming up', 'coming up', 'what events', 'future events', 'what\'s happening', 'whats happening']
  const isFutureEventQuery = futureEventKeywords.some(kw => lower.includes(kw))
  
  if (isFutureEventQuery) {
    categories.push('upcoming', 'recurring')
    return {
      categories,
      reasoning: 'General future event query - includes both upcoming and recurring'
    }
  }

  for (const [cat, config] of Object.entries(CATEGORY_CONFIG) as [ContentCategory, typeof CATEGORY_CONFIG[ContentCategory]][]) {
    if (config.keywords.some(kw => lower.includes(kw))) {
      categories.push(cat)
    }
  }

  // If no specific categories detected, include all relevant ones
  if (categories.length === 0) {
    categories.push('upcoming', 'recurring', 'facts', 'announcements', 'polls')
  }

  return {
    categories,
    reasoning: 'Keyword-based detection'
  }
}

/**
 * Generate a better search query for category-based queries using LLM
 */
async function generateSearchQueryForCategory(originalQuery: string, category: ContentCategory): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    // Fallback: return original query
    return originalQuery
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const systemPrompt = `Generate search terms that would find content items in the "${category}" category.
    
Examples:
- Query: "what are recurring events" → Search terms: "meetings weekly events study hall active meeting" (terms that match recurring events)
- Query: "what are upcoming events" → Search terms: "events trips retreats schedule calendar upcoming" (terms that match upcoming events)
- Query: "what are past events" → Search terms: "events activities past completed" (terms that match past events)

Respond with JSON: { "searchTerms": string }
The searchTerms should be a space-separated list of keywords that would help find relevant items in that category.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Original query: "${originalQuery}"\nCategory: ${category}\nGenerate search terms:` }
      ],
      temperature: 0.2,
      max_tokens: 100,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      const searchTerms = parsed.searchTerms || originalQuery
      console.log(`[ContentQuery] Generated search terms for ${category} category: "${searchTerms}"`)
      return searchTerms
    }
  } catch (error) {
    console.error('[ContentQuery] Search query generation failed:', error)
  }

  // Fallback: return original query
  return originalQuery
}

/**
 * Check if content describes a recurring event by examining body text
 */
async function isRecurringFromContent(body: string): Promise<boolean> {
  if (!process.env.OPENAI_API_KEY) {
    // Fallback: simple keyword check
    const bodyLower = body.toLowerCase()
    return bodyLower.includes('every') && 
           (bodyLower.includes('wednesday') || bodyLower.includes('monday') || bodyLower.includes('tuesday') || 
            bodyLower.includes('thursday') || bodyLower.includes('friday') || bodyLower.includes('saturday') || 
            bodyLower.includes('sunday') || bodyLower.includes('week') || bodyLower.includes('weekly'))
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Determine if this content describes a RECURRING event (happens regularly like "every Wednesday", "weekly meeting"). Respond with JSON: { "isRecurring": boolean }'
        },
        {
          role: 'user',
          content: `Content: "${body.substring(0, 300)}"\nIs this a recurring event that happens on a regular schedule?`
        }
      ],
      temperature: 0.1,
      max_tokens: 50,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      return parsed.isRecurring || false
    }
  } catch (error) {
    console.error('[ContentQuery] Recurring detection from content failed:', error)
  }

  // Fallback: keyword check
  const bodyLower = body.toLowerCase()
  return bodyLower.includes('every') && 
         (bodyLower.includes('wednesday') || bodyLower.includes('monday') || bodyLower.includes('tuesday') || 
          bodyLower.includes('thursday') || bodyLower.includes('friday') || bodyLower.includes('saturday') || 
          bodyLower.includes('sunday') || bodyLower.includes('week') || bodyLower.includes('weekly'))
}

/**
 * Assign category to a content result based on its existing metadata (dateStr, timeRef, eventDate)
 * Uses the same categorization logic as the inbox: UPCOMING, RECURRING, PAST, FACTS
 */
async function assignCategoryToResult(result: ContentResult & { source?: 'content' | 'announcement' | 'poll'; eventDate?: Date }): Promise<ContentCategory> {
  const now = new Date()
  now.setHours(0, 0, 0, 0) // Compare dates only, not times

  // Assign based on source type (announcements/polls are always past)
  if (result.source === 'announcement') return 'announcements'
  if (result.source === 'poll') return 'polls'

  // Check if dateStr indicates recurring pattern (matches inbox logic)
  if (result.dateStr?.startsWith('recurring:')) {
    return 'recurring'
  }

  // Check if timeRef indicates recurring pattern (e.g., "every Wednesday")
  if (result.timeRef) {
    const timeRefLower = result.timeRef.toLowerCase()
    if (timeRefLower.includes('every') || 
        timeRefLower.includes('weekly') || 
        timeRefLower.includes('recurring') ||
        /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(at|@)?/.test(timeRefLower)) {
      return 'recurring'
    }
  }

  // Check body content for recurring patterns if no dateStr or timeRef indicates it
  if (result.body) {
    const isRecurring = await isRecurringFromContent(result.body)
    if (isRecurring) {
      return 'recurring'
    }
  }

  // Assign based on eventDate or dateStr (parse date and compare)
  if (result.eventDate) {
    const eventDate = new Date(result.eventDate)
    eventDate.setHours(0, 0, 0, 0)
    if (eventDate >= now) {
      return 'upcoming'
    } else {
      return 'past'
    }
  }

  if (result.dateStr && !result.dateStr.startsWith('recurring:')) {
    try {
      const eventDate = new Date(result.dateStr)
      eventDate.setHours(0, 0, 0, 0)
      if (eventDate >= now) {
        return 'upcoming'
      } else {
        return 'past'
      }
    } catch (e) {
      // Invalid date, treat as fact
    }
  }

  // Default to facts (no date or invalid date)
  return 'facts'
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
 * Detect if query is asking for a definition/meta query about a category (not a specific object)
 * Uses LLM to understand intent
 */
async function isCategoryQuery(query: string): Promise<boolean> {
  if (!process.env.OPENAI_API_KEY) {
    // Fallback: simple heuristic
    const lower = query.toLowerCase()
    return /^(what|show|list|tell me about)\s+(are|is|the\s+)?(announcements?|polls?|recurring|events?)/i.test(lower) ||
           /^(what|show|list)\s+(announcements?|polls?|events?)\s+(have|were)/i.test(lower)
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const systemPrompt = `Determine if the user is asking a META/CATEGORY query (asking about all items in a category) vs a SPECIFIC OBJECT query (asking about a particular item).

CATEGORY QUERIES (return true):
- "what are recurring events" (asking about all recurring events)
- "what announcements have been made" (asking about all announcements)
- "show me past announcements" (asking about all past announcements)
- "what's on my calendar" (meta query aggregating categories)
- "list recurring events" (asking about all recurring events)

SPECIFIC OBJECT QUERIES (return false):
- "when is active meeting" (asking about a specific event)
- "tell me about the ski trip announcement" (asking about a specific announcement)
- "what did you send about study hall" (asking about a specific announcement related to study hall)

Respond with JSON: { "isCategoryQuery": boolean, "reasoning": string }`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Is this a category/meta query? "${query}"` }
      ],
      temperature: 0.1,
      max_tokens: 100,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      return parsed.isCategoryQuery || false
    }
  } catch (error) {
    console.error('[ContentQuery] Category query detection failed:', error)
  }

  // Fallback: simple heuristic
  const lower = query.toLowerCase()
  return /^(what|show|list|tell me about)\s+(are|is|the\s+)?(announcements?|polls?|recurring|events?)/i.test(lower) ||
         /^(what|show|list)\s+(announcements?|polls?|events?)\s+(have|were)/i.test(lower)
}

/**
 * Find associations between events and announcements/polls
 * Uses LLM to determine if announcements/polls are related to events
 */
async function findAssociations(
  events: Array<ContentResult & { category?: ContentCategory }>,
  announcements: Array<ContentResult & { category?: ContentCategory; sentDate?: Date }>
): Promise<Map<string, Array<ContentResult & { category?: ContentCategory }>>> {
  const associations = new Map<string, Array<ContentResult & { category?: ContentCategory }>>()

  if (events.length === 0 || announcements.length === 0) {
    return associations
  }

  if (!process.env.OPENAI_API_KEY) {
    // Fallback: simple keyword matching
    for (const event of events) {
      const eventKeywords = (event.title + ' ' + event.body).toLowerCase().split(/\s+/).filter(w => w.length > 3)
      const related = announcements.filter(ann => {
        const annText = ann.body.toLowerCase()
        return eventKeywords.some(kw => annText.includes(kw))
      })
      if (related.length > 0) {
        associations.set(event.title || 'unknown', related)
      }
    }
    return associations
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    // Group events by potential associations
    const eventSummaries = events.map(e => `${e.title || 'Event'}: ${e.body.substring(0, 100)}`).join('\n')
    const announcementSummaries = announcements.map((a, i) => 
      `[${i}] ${a.body.substring(0, 100)}`
    ).join('\n')

    const systemPrompt = `Determine which announcements/polls are related to which events.
    
Events:
${eventSummaries}

Announcements/Polls:
${announcementSummaries}

Respond with JSON mapping event titles to arrays of announcement indices: { "event_title": [0, 2], ... }
Only include associations if the announcement/poll provides context or information about the event.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Find associations between events and announcements/polls.' }
      ],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      for (const [eventTitle, indices] of Object.entries(parsed)) {
        if (Array.isArray(indices)) {
          const related = (indices as number[])
            .filter(idx => idx >= 0 && idx < announcements.length)
            .map(idx => announcements[idx])
          if (related.length > 0) {
            associations.set(eventTitle, related)
          }
        }
      }
    }
  } catch (error) {
    console.error('[ContentQuery] Association detection failed:', error)
    // Fallback to keyword matching
    for (const event of events) {
      const eventKeywords = (event.title + ' ' + event.body).toLowerCase().split(/\s+/).filter(w => w.length > 3)
      const related = announcements.filter(ann => {
        const annText = ann.body.toLowerCase()
        return eventKeywords.some(kw => annText.includes(kw))
      })
      if (related.length > 0) {
        associations.set(event.title || 'unknown', related)
      }
    }
  }

  return associations
}

/**
 * Filter results by category based on query intent
 */
function filterResultsByCategories(
  results: Array<ContentResult & { category?: ContentCategory; source?: 'content' | 'announcement' | 'poll'; sentDate?: Date }>,
  targetCategories: ContentCategory[]
): Array<ContentResult & { category?: ContentCategory; source?: 'content' | 'announcement' | 'poll'; sentDate?: Date }> {
  // If all categories are requested, return all results
  const allCategories: ContentCategory[] = ['upcoming', 'recurring', 'past', 'facts', 'announcements', 'polls']
  if (targetCategories.length === allCategories.length || targetCategories.length === 0) {
    return results
  }

  return results.filter(r => {
    const resultCategory = r.category || 'facts'

    // Always include announcements and polls when the user is asking about
    // events or facts, even if they didn't explicitly say "announcements" or "polls".
    // This makes info that only lives in announcements/polls still queryable.
    if (resultCategory === 'announcements' || resultCategory === 'polls') {
      if (
        targetCategories.includes('facts') ||
        targetCategories.includes('upcoming') ||
        targetCategories.includes('recurring') ||
        targetCategories.includes('past')
      ) {
        return true
      }
    }

    return targetCategories.includes(resultCategory)
  })
}

/**
 * Use LLM to filter and format relevant results
 */
async function filterAndFormatResultsWithLLM(
  query: string,
  allResults: Array<ContentResult & { category?: ContentCategory; source?: 'content' | 'announcement' | 'poll'; sentDate?: Date; eventDate?: Date }>,
  targetCategories: ContentCategory[]
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
    
    // Filter results by target categories
    const filteredResults = filterResultsByCategories(allResults, targetCategories)

    // Extract main topic words from the query (excluding common stop words)
    const queryWordsAll = query.toLowerCase().split(/\s+/).filter(w => w.length > 1)
    const topicWords = queryWordsAll.filter(w => w.length > 2 && !FALLBACK_KEYWORDS.includes(w))

    // Determine which results directly mention the main topic words
    const isPrimaryMatch = (r: ContentResult & { category?: ContentCategory; source?: 'content' | 'announcement' | 'poll'; sentDate?: Date; eventDate?: Date }) => {
      if (topicWords.length === 0) return false
      const text = `${r.title || ''} ${r.body || ''}`.toLowerCase()
      return topicWords.some(word => text.includes(word))
    }

    const primaryResultsCount = filteredResults.filter(isPrimaryMatch).length

    // Format results for LLM, including category metadata
    // Note: categories should already be assigned in handleContentQuery before this function is called
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    const formattedResults = filteredResults.map((r, idx) => {
      // Category should already be assigned, but fallback to 'facts' if missing
      const category: ContentCategory = r.category || 'facts'
      
      // Highlight relevance by showing how the result relates to the query
      let relevanceNote = ''
      const titleLower = (r.title || '').toLowerCase()
      const bodyLower = (r.body || '').toLowerCase()
      const matchesQuery = queryWords.some(word => 
        titleLower.includes(word) || bodyLower.includes(word)
      )
      if (matchesQuery) {
        relevanceNote = ' [RELEVANT TO QUERY]'
      }

      // Mark primary matches that directly mention the topic words
      if (isPrimaryMatch(r)) {
        relevanceNote += relevanceNote ? ' [PRIMARY_MATCH]' : ' [PRIMARY_MATCH]'
      }
      
      let resultText = `[${idx + 1}] ${r.source === 'announcement' ? '📢' : r.source === 'poll' ? '📊' : '📋'} ${r.title || 'Info'}${relevanceNote}\n${r.body}`
      
      // Add category information (this helps LLM understand context)
      resultText += `\nCategory: ${category.toUpperCase()}`
      
      // Add time direction metadata
      const timeDirection = CATEGORY_CONFIG[category].timeDirection
      if (timeDirection !== 'none') {
        resultText += ` (${timeDirection} dates)`
      }
      
      // Add next occurrence for recurring items
      if (category === 'recurring' && r.dateStr?.startsWith('recurring:')) {
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
      
      // Add event date for upcoming events
      if ((category === 'upcoming' || category === 'past') && r.eventDate) {
        const eventDate = r.eventDate instanceof Date ? r.eventDate : new Date(r.eventDate)
        const year = eventDate.getFullYear()
        const month = String(eventDate.getMonth() + 1).padStart(2, '0')
        const day = String(eventDate.getDate()).padStart(2, '0')
        const dateStr = `${year}-${month}-${day}`
        resultText += `\nEvent date: ${dateStr}`
      }
      
      // Add context about sent date for announcements/polls (relative date parsing)
      if ((category === 'announcements' || category === 'polls') && r.sentDate) {
        const sentDate = r.sentDate instanceof Date ? r.sentDate : new Date(r.sentDate)
        // Use local date, not UTC, to avoid timezone issues
        const year = sentDate.getFullYear()
        const month = String(sentDate.getMonth() + 1).padStart(2, '0')
        const day = String(sentDate.getDate()).padStart(2, '0')
        const dateStr = `${year}-${month}-${day}`
        const sentDayName = dayNames[sentDate.getDay()]
        resultText += `\nSent on: ${dateStr} (${sentDayName}). When this mentions relative dates like "tomorrow", "tmr", "next week", calculate them relative to ${dateStr}, not today's date.`
      }
      
      return resultText
    }).join('\n\n')

    const systemPrompt = `You are a helpful assistant that answers questions using the provided search results organized by category.

PRIMARY MATCHES:
- There are ${primaryResultsCount} results that directly mention the main topic words from the user's question (${topicWords.join(', ') || 'none'}).
- Any result marked with [PRIMARY_MATCH] is directly about what the user asked (e.g., an announcement that literally mentions "soccer").
- You MUST base your answer on PRIMARY_MATCH results first if any exist, before considering other results.

CRITICAL: If search results are provided, they ARE relevant to the query. DO NOT say "no information" or "I don't have that information" if results are provided. Use the information in the results to answer the question, even if it's incomplete.

TODAY'S CONTEXT:
- Today is ${todayDayName}, ${todayStr}
- Use this to calculate relative dates and determine when recurring events occur next

CATEGORY SYSTEM:
Results are organized by categories with time directionality:
- UPCOMING: Future one-time events (has future dates, timeDirection: future)
- RECURRING: Events that repeat weekly (e.g., "every Wednesday", timeDirection: future)
- PAST: Past events (has previous dates, timeDirection: past)
- FACTS: General information from knowledge base (timeDirection: none)
- ANNOUNCEMENTS: Past messages that were sent (timeDirection: past)
- POLLS: Past questions that were sent (timeDirection: past)

BIDIRECTIONAL QUERY UNDERSTANDING:
- When user asks about a specific object (e.g., "when is active meeting"), understand that it exists in a category (likely RECURRING or UPCOMING) based on the results
- When user asks about a category (e.g., "what are recurring events", "what's on my calendar", "what are past announcements"), filter and return only items from those categories
- Meta queries like "what's on my calendar" should aggregate UPCOMING, RECURRING, ANNOUNCEMENTS, and POLLS categories
- Category queries like "what are recurring events" should return only RECURRING items with their patterns and next occurrences

CRITICAL: FACT-CHECKING RULES:
- ONLY use dates that are explicitly stated in the search results
- DO NOT make up or hallucinate dates
- If a date is not in the results, calculate it from the information provided
- When combining recurring patterns with announcements:
  * If an announcement says "active meeting is tmr" and was sent on Jan 6, that means Jan 7
  * If the knowledge base says "active meeting is every Wednesday" and today's context shows Jan 7 is a Wednesday, that confirms the last one was Jan 7
  * Calculate the NEXT occurrence from today's date: if today is after Jan 7, find the next Wednesday
  * If today is Tuesday Jan 9, and the last active meeting was Wednesday Jan 7, the next one is Wednesday Jan 14 (next week)

TIME DIRECTIONALITY:
- UPCOMING and RECURRING categories contain future dates
- PAST, ANNOUNCEMENTS, and POLLS categories contain past dates
- Use the Category and timeDirection metadata to understand temporal context
- Relative dates in announcements/polls are calculated from their "Sent on" date, NOT today

ASSOCIATIONS:
- Announcements/polls may be associated with events (check if they provide context)
- When presenting an event, supplement with any associated announcements/polls that provide additional context

YOUR TASK:
1. If search results are provided, you MUST use them to answer the question. DO NOT say "no information available" if results exist.
2. Use the Category metadata to understand which category each result belongs to and its time directionality
3. For category queries (e.g., "what are recurring events"), return only results from that category with their details
4. For object queries (e.g., "when is active meeting"), infer the category from results (likely RECURRING or UPCOMING) and provide details
5. For meta/summary queries (e.g., "what's on my calendar", "what events are coming up"):
   - Aggregate and summarize events across all relevant categories (UPCOMING, RECURRING, ANNOUNCEMENTS, POLLS)
   - Organize by category (UPCOMING, RECURRING, etc.) as headers
   - Sort by most upcoming first - recurring events with next occurrence dates, then upcoming events by date
   - For recurring events, show the pattern AND next occurrence date
   - For upcoming events, show the specific date
   - Keep the summary concise but informative
6. For general future event queries (questions about "what's coming up", "future events", etc.), include BOTH upcoming and recurring categories
7. Extract and present information from the results, even if incomplete:
   - If a fact says "Study Hall every Wednesday at 6:30 PM", present that information (category: RECURRING)
   - If a fact says "AE Summons date is TBD", say "AE Summons date is TBD (to be determined)" (category: FACTS)
   - If time/location isn't mentioned, don't make it up, but do provide what IS available
8. For ALL events (recurring or one-time), ALWAYS include what information is available:
   - Date (specific date, recurrence pattern, or "TBD" if mentioned)
   - Time (if mentioned in results)
   - Location (if mentioned in results)
   - For recurring: state the pattern (e.g., "every Wednesday") AND calculate the next occurrence if possible
9. For recurring items, ALWAYS mention when the next occurrence will be if you can calculate it:
   * If today is Tuesday Jan 9 and the event is every Wednesday, next is Wednesday Jan 14
   * State it clearly: "every Wednesday, next is January 14"
   * If date is TBD, say "date is TBD (to be determined)"
10. When you see both a recurring pattern AND an announcement about a specific occurrence:
   * The announcement tells you when one specific instance happened (relative to its sent date)
   * Use that to determine the last occurrence date
   * Then calculate the next occurrence from today's date using the recurring pattern
   * Example: Announcement sent Jan 6 says "active meeting is tmr" → that's Jan 7. Pattern is every Wednesday. Today is Jan 9 (Tuesday). Last was Jan 7 (Wednesday). Next is Jan 14 (next Wednesday).
11. Supplement events with associated announcements/polls if they provide context
12. Combine relevant information from multiple results to provide complete answers
13. If a date is not in the results, calculate it from recurring patterns and today's date if possible
14. DO NOT make up dates that aren't in the results or can't be calculated
15. If information is incomplete (e.g., "TBD", no date mentioned), state what you know and note what's missing

FORMATTING RULES:
- DO NOT use markdown formatting - NO asterisks, NO bold, NO markdown lists
- Write plain text as if sending a text message
- Use simple dashes or numbers for lists (e.g., "1. item" or "- item")
- For category headers, use ALL CAPS followed by colon (e.g., "UPCOMING:", "RECURRING:", "PAST ANNOUNCEMENTS:")
- Keep formatting minimal and natural
- When responding to category queries, clearly state which category you're providing information about
- When responding to object queries, infer and state the category if relevant (e.g., "this is a recurring event", "this announcement was sent a week ago")
- For meta/summary queries, organize by category and sort by most upcoming first`

    const categoryInfo = targetCategories.length > 0 && targetCategories.length < 6
      ? `\n\nQuery is asking about categories: ${targetCategories.join(', ')}`
      : ''

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Question: "${query}"${categoryInfo}\n\nSearch Results (${filteredResults.length} results found - these results ARE relevant to your query):\n${formattedResults}\n\nCRITICAL INSTRUCTIONS:
- These ${filteredResults.length} search results were found by searching the knowledge base for "${query}"
- If a result mentions the topic from your question (e.g., "study hall", "ae summons"), it IS relevant and you MUST use it
- Even if information is incomplete (e.g., "TBD", no date), still provide what IS available
- DO NOT say "no information available" or "I don't have that information" when ${filteredResults.length} results are provided
- Use the Category metadata to understand time directionality and filter appropriately
- Extract and present the information from these results to answer the question\n\nProvide a clear, complete answer based on the results above:` }
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
 * Convert EventResult to ContentResult format
 */
function eventToContentResult(event: EventResult): ContentResult {
  const now = new Date()
  const category: ContentCategory = event.eventDate >= now ? 'upcoming' : 'past'
  
  let body = `📅 ${event.title}`
  if (event.description) body += `\n${event.description}`
  if (event.location) body += `\n📍 ${event.location}`
  body += `\n📅 ${event.eventDate.toISOString().split('T')[0]}`
  
  return {
    title: event.title,
    body,
    score: 0.8, // High relevance for events
    dateStr: event.eventDate.toISOString().split('T')[0],
    category,
    eventDate: event.eventDate
  }
}

/**
 * Handle content query action
 * Searches content database, events, and past announcements/polls, then uses LLM to filter and format results.
 */
export async function handleContentQuery(input: ContentQueryInput): Promise<ActionResult> {
  const { phone, message, userName, searchContent, searchEvents, recentMessages, searchPastActions } = input
  
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
  
  // Detect which categories the query is asking about
  console.log(`[ContentQuery] Detecting query categories...`)
  const { categories: targetCategories, reasoning } = await detectQueryCategories(message)
  console.log(`[ContentQuery] Target categories: ${targetCategories.join(', ')} (${reasoning})`)
  
  // Collect all results from all sources
  const allResults: Array<ContentResult & { source?: 'content' | 'announcement' | 'poll'; sentDate?: Date; eventDate?: Date }> = []
  
  // 1. Search content database (Facts)
  // Search broadly and let categorization + LLM processing handle filtering
  if (searchContent && (targetCategories.includes('facts') || targetCategories.includes('upcoming') || targetCategories.includes('recurring') || targetCategories.includes('past'))) {
    console.log(`[ContentQuery] Searching content database...`)
    try {
      // Use LLM to generate a better search query if this is a category query
      // This helps find relevant events/meetings even when query doesn't explicitly mention them
      let searchQuery = message
      if (targetCategories.includes('recurring') && targetCategories.length === 1) {
        // For recurring-only queries, use LLM to generate search terms that would find recurring events
        searchQuery = await generateSearchQueryForCategory(message, 'recurring')
      } else if (targetCategories.includes('recurring') && targetCategories.length > 1) {
        // For queries that include recurring, expand the search to include recurring event terms
        // This ensures recurring events are found even when query mentions multiple categories
        const recurringTerms = await generateSearchQueryForCategory(message, 'recurring')
        // Combine original query with recurring-specific terms
        searchQuery = `${message} ${recurringTerms}`
      } else if (targetCategories.length === 1 && targetCategories.includes('upcoming')) {
        // For upcoming-only queries, use LLM to generate search terms for future events
        searchQuery = await generateSearchQueryForCategory(message, 'upcoming')
      }
      
      const contentResults = await searchContent(searchQuery)
      console.log(`[ContentQuery] Found ${contentResults.length} content results (search query: "${searchQuery}")`)
      
      // Assign categories to all results using existing metadata (await since it's async)
      const categorizedResults = await Promise.all(
        contentResults.map(async r => {
          const category = await assignCategoryToResult({ ...r, source: 'content' })
          console.log(`[ContentQuery] Categorized result: "${r.title || 'untitled'}" as ${category} (dateStr: ${r.dateStr}, timeRef: ${r.timeRef})`)
          return { 
            ...r, 
            source: 'content' as const,
            category,
            dateStr: r.dateStr || null,
            timeRef: r.timeRef || null
          }
        })
      )
      
      allResults.push(...categorizedResults)
      console.log(`[ContentQuery] Category breakdown: ${Object.entries(
        categorizedResults.reduce((acc, r) => {
          const cat = r.category || 'facts'
          acc[cat] = (acc[cat] || 0) + 1
          return acc
        }, {} as Record<string, number>)
      ).map(([cat, count]) => `${cat}: ${count}`).join(', ')}`)
    } catch (error) {
      console.error('[ContentQuery] Content search failed:', error)
    }
  }
  
  // 2. Search Events from Event table
  if (searchEvents && (targetCategories.includes('upcoming') || targetCategories.includes('past'))) {
    console.log(`[ContentQuery] Searching events...`)
    try {
      const events = await searchEvents()
      console.log(`[ContentQuery] Found ${events.length} events`)
      const eventResults = events.map(eventToContentResult)
      allResults.push(...eventResults)
    } catch (error) {
      console.error('[ContentQuery] Event search failed:', error)
    }
  }
  
  // 3. Search past announcements/polls (always search, not just when categories are detected)
  if (searchPastActions) {
    console.log(`[ContentQuery] Searching past announcements/polls...`)
    try {
      const pastActions = await searchPastActions()
      console.log(`[ContentQuery] Found ${pastActions.length} past actions`)
      
      // Use LLM to determine if this is a category query (meta query about all items) vs specific object query
      const isMetaQuery = await isCategoryQuery(message)
      console.log(`[ContentQuery] Is category/meta query: ${isMetaQuery}`)
      
      const queryLower = message.toLowerCase()
      // Extract meaningful keywords (longer words, not common stop words)
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2 && !FALLBACK_KEYWORDS.includes(w))
      // Also keep shorter meaningful words if they're the main content
      const allQueryWords = queryLower.split(/\s+/).filter(w => w.length > 1)
      
      const mappedActions = pastActions
        .filter(action => {
          // For category/meta queries (e.g., "what announcements have been made"), include all items
          if (isMetaQuery) {
            return true
          }
          
          const contentLower = action.content.toLowerCase()
          
          // First, try matching with extracted keywords
          if (queryWords.length > 0) {
            // Match if any keyword appears in content
            if (queryWords.some(word => contentLower.includes(word))) {
              return true
            }
          }
          
          // If no keyword matches, try matching the full query or parts of it
          // This catches cases like "when is soccer" where "soccer" might be the only meaningful word
          if (allQueryWords.length > 0) {
            // Check if any word from the query appears in content (more lenient)
            const meaningfulWords = allQueryWords.filter(w => w.length > 2)
            if (meaningfulWords.length > 0 && meaningfulWords.some(word => contentLower.includes(word))) {
              return true
            }
            // Also check if the query itself appears as a substring (for exact matches)
            if (contentLower.includes(queryLower)) {
              return true
            }
          }
          
          // If still no match, include if query matches category intent
          return targetCategories.includes('announcements') || targetCategories.includes('polls') || targetCategories.length === 0
        })
        .map(action => {
          const sentDate = action.sentAt instanceof Date ? action.sentAt : new Date(action.sentAt)
          const year = sentDate.getFullYear()
          const month = String(sentDate.getMonth() + 1).padStart(2, '0')
          const day = String(sentDate.getDate()).padStart(2, '0')
          const dateStr = `${year}-${month}-${day}`
          
          const category: ContentCategory = action.type === 'poll' ? 'polls' : 'announcements'
          
          // Calculate relevance score based on query match
          let score = 0.5
          const contentLower = action.content.toLowerCase()
          
          // Boost score if query words appear in content
          if (queryWords.length > 0) {
            const matches = queryWords.filter(word => contentLower.includes(word)).length
            score = 0.5 + (matches / queryWords.length) * 0.4 // Boost up to 0.9
          }
          
          // Boost score if full query appears in content
          if (contentLower.includes(queryLower)) {
            score = Math.max(score, 0.8)
          }
          
          // Also check meaningful words from all query words
          const meaningfulWords = allQueryWords.filter(w => w.length > 2)
          if (meaningfulWords.length > 0) {
            const matches = meaningfulWords.filter(word => contentLower.includes(word)).length
            if (matches > 0) {
              score = Math.max(score, 0.6 + (matches / meaningfulWords.length) * 0.3)
            }
          }
          
          return {
            title: action.type === 'poll' ? 'Poll' : 'Announcement',
            body: `${action.type === 'poll' ? '📊' : '📢'} ${action.content}${action.type === 'poll' ? '\n(Reply yes/no/maybe)' : ''}\n(Sent: ${dateStr})`,
            score,
            source: action.type === 'poll' ? 'poll' as const : 'announcement' as const,
            category,
            sentDate: new Date(year, sentDate.getMonth(), sentDate.getDate())
          }
        })
      
      allResults.push(...mappedActions)
      console.log(`[ContentQuery] Found ${mappedActions.length} relevant past actions`)
    } catch (error) {
      console.error('[ContentQuery] Past actions search failed:', error)
    }
  }
  
  // Find associations between events and announcements/polls
  const events = allResults.filter(r => r.category === 'upcoming' || r.category === 'recurring' || r.category === 'past')
  const announcements = allResults.filter(r => r.category === 'announcements' || r.category === 'polls')
  const associations = await findAssociations(events, announcements)
  
  // Supplement events with associated announcements/polls
  if (associations.size > 0) {
    console.log(`[ContentQuery] Found ${associations.size} event-association pairs`)
    for (const [eventTitle, relatedAnnouncements] of associations.entries()) {
      const event = allResults.find(r => r.title === eventTitle)
      if (event && relatedAnnouncements.length > 0) {
        // Add association context to event body
        event.body += `\n\nRelated context:\n${relatedAnnouncements.map(a => a.body).join('\n')}`
      }
    }
  }
  
  // Sort all results by category priority
  allResults.sort((a, b) => {
    const categoryA = a.category || 'facts'
    const categoryB = b.category || 'facts'
    const priorityA = CATEGORY_CONFIG[categoryA]?.priority || 0
    const priorityB = CATEGORY_CONFIG[categoryB]?.priority || 0
    
    if (priorityA !== priorityB) {
      return priorityB - priorityA // Higher priority first
    }
    
    // Same priority, sort by score
    return (b.score || 0) - (a.score || 0)
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
  console.log(`[ContentQuery] Filtering and formatting ${allResults.length} results with LLM (target categories: ${targetCategories.join(', ')})...`)
  const formattedResponse = await filterAndFormatResultsWithLLM(message, allResults, targetCategories)
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

