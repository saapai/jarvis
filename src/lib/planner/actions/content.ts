/**
 * Content Query Handler
 * Handles questions about organization content (events, meetings, etc.)
 * Uses a generalizable category-based system for organizing and querying content
 */

import { ActionResult } from '../types'
import { TEXTER_MODEL, HELPER_MODEL } from '../models'
import { TEMPLATES } from '../personality'

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
  // Distinct topics in the knowledge base — for "what info do you know" overview asks
  listKnownTopics?: () => Promise<string[]>
}

export interface ContentResult {
  title: string
  body: string
  score: number
  dateStr?: string | null
  timeRef?: string | null
  category?: ContentCategory
  eventDate?: Date
  sourceText?: string | null  // Full original text (may contain URLs/links)
  entities?: string[] | null      // extracted entities — often where signup URLs live
  calendarDates?: string[] | null // every parsed date (YYYY-MM-DD), not just the range start
  details?: FactDetail[] | null   // structured sub-items grouped under this entity (per-city dates+links)
}

// Structured sub-detail of a fact (kept in sync with text-explorer/detailsExtraction).
export interface FactDetail {
  label: string
  date?: string
  url?: string
  location?: string
  note?: string
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
  isOverview?: boolean
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
- "what is the retreat rsvp link" or "retreat link" → categories: ["upcoming", "recurring", "facts"] (link queries should search all categories where the event might be)
- "rsvp link" or "registration link" → categories: ["upcoming", "recurring", "facts", "announcements"] (link queries need to search broadly)
- Any question about links/RSVPs for events → include ["upcoming", "recurring", "facts"] to find the event
- Any question about future events without specific category → include both ["upcoming", "recurring"]

OVERVIEW QUERIES: if the user is asking about the SCOPE of what the bot knows — "what info do you know", "what do you know", "what's in your notes", "what kind of stuff can i ask you", "what do you have on the org" — set "isOverview": true (categories can be empty). These want a sampler of known topics, not a search for one topic. A question about a SPECIFIC thing ("what do you know about the retreat") is NOT an overview — that's a normal search.

Respond with JSON: { "categories": string[], "reasoning": string, "isOverview": boolean }
Categories should be one of: upcoming, recurring, past, facts, announcements, polls`

    const response = await openai.chat.completions.create({
      model: HELPER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `What categories is this query asking about? "${message}"` }
      ],
      temperature: 0, // category detection feeds which facts get retrieved — must be deterministic
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
        reasoning: parsed.reasoning || 'LLM analysis',
        isOverview: parsed.isOverview === true
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
      model: HELPER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Original query: "${originalQuery}"\nCategory: ${category}\nGenerate search terms:` }
      ],
      temperature: 0, // search-term generation — deterministic so retrieval doesn't vary run to run
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
// A body with none of these words CANNOT be a recurring event, so it never needs the
// LLM check — this gate is what eliminates the per-result recurring-detection fan-out.
const RECURRENCE_SIGNAL = /\b(every|weekly|bi-?weekly|monthly|recurring|daily|each\s+(week|month|day)|weekdays?|weekends?)\b|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i

/**
 * One LLM call to classify N result bodies as recurring-or-not, instead of one call
 * per result. Only ambiguous bodies (those with a recurrence signal word but no
 * recurring dateStr/timeRef) ever reach here, so the list is usually tiny or empty.
 */
async function batchDetectRecurring(bodies: string[]): Promise<boolean[]> {
  if (bodies.length === 0) return []
  // Offline/test fallback mirrors the original strict keyword heuristic
  const strictKeyword = (b: string) => {
    const s = b.toLowerCase()
    return s.includes('every') && /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|weekly)/.test(s)
  }
  if (!process.env.OPENAI_API_KEY) return bodies.map(strictKeyword)

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const list = bodies.map((b, i) => `${i}. "${b.substring(0, 300)}"`).join('\n')
    const response = await openai.chat.completions.create({
      model: HELPER_MODEL,
      messages: [
        {
          role: 'system',
          content: 'For EACH numbered item, decide if it describes a RECURRING event (happens regularly on a schedule like "every Wednesday", "weekly meeting"). Respond with JSON covering every item: { "results": [{ "i": number, "isRecurring": boolean }, ...] }'
        },
        { role: 'user', content: list }
      ],
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    })
    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      const flags = new Array(bodies.length).fill(false)
      if (Array.isArray(parsed.results)) {
        for (const r of parsed.results) {
          if (typeof r?.i === 'number' && r.i >= 0 && r.i < bodies.length) flags[r.i] = !!r.isRecurring
        }
      }
      return flags
    }
  } catch (error) {
    console.error('[ContentQuery] Batch recurring detection failed:', error)
  }
  return bodies.map(strictKeyword)
}

// Date-based categorization (no LLM). UPCOMING / PAST / FACTS from eventDate or dateStr.
function categorizeByDate(result: ContentResult & { eventDate?: Date }): ContentCategory {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  if (result.eventDate) {
    const d = new Date(result.eventDate)
    d.setHours(0, 0, 0, 0)
    return d >= now ? 'upcoming' : 'past'
  }
  if (result.dateStr && !result.dateStr.startsWith('recurring:')) {
    try {
      const d = new Date(result.dateStr)
      d.setHours(0, 0, 0, 0)
      return d >= now ? 'upcoming' : 'past'
    } catch {
      // invalid date → fact
    }
  }
  return 'facts'
}

/**
 * Synchronous category assignment from existing metadata (dateStr, timeRef, eventDate).
 * Returns a category, OR null when the body carries a recurrence signal and needs the
 * batched LLM confirmation to decide recurring-vs-dated. Same logic as the inbox.
 */
function categorizeResultSync(result: ContentResult & { source?: 'content' | 'announcement' | 'poll'; eventDate?: Date }): ContentCategory | null {
  // Assign based on source type (announcements/polls are always past)
  if (result.source === 'announcement') return 'announcements'
  if (result.source === 'poll') return 'polls'

  // dateStr recurring pattern (matches inbox logic)
  if (result.dateStr?.startsWith('recurring:')) return 'recurring'

  // Week-of-term style events (e.g., "week:5") behave like upcoming — keeps
  // "Kegger" / "Formal" week cards queryable even without a concrete date.
  if (result.dateStr?.startsWith('week:')) return 'upcoming'

  // timeRef recurring pattern (e.g., "every Wednesday")
  if (result.timeRef) {
    const t = result.timeRef.toLowerCase()
    if (t.includes('every') || t.includes('weekly') || t.includes('recurring') ||
        /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(at|@)?/.test(t)) {
      return 'recurring'
    }
  }

  // Only bodies with a recurrence signal are ambiguous enough to need the LLM.
  // Everything else is categorized by date right here, no LLM call.
  if (result.body && RECURRENCE_SIGNAL.test(result.body)) return null

  return categorizeByDate(result)
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
      model: HELPER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Is this a category/meta query? "${query}"` }
      ],
      temperature: 0,
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
      model: HELPER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Find associations between events and announcements/polls.' }
      ],
      temperature: 0,
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
export function filterResultsByCategories(
  results: Array<ContentResult & { category?: ContentCategory; source?: 'content' | 'announcement' | 'poll'; sentDate?: Date }>,
  targetCategories: ContentCategory[],
  query?: string
): Array<ContentResult & { category?: ContentCategory; source?: 'content' | 'announcement' | 'poll'; sentDate?: Date }> {
  // If all categories are requested, return all results
  const allCategories: ContentCategory[] = ['upcoming', 'recurring', 'past', 'facts', 'announcements', 'polls']
  if (targetCategories.length === allCategories.length || targetCategories.length === 0) {
    return results
  }

  // Topic words from the query — a result that literally names what the user asked
  // about should never be dropped on a category technicality (e.g. "alumni reunion"
  // stored as a plain fact with no parsed date still answers "when are the reunions")
  const topicWords = (query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !FALLBACK_KEYWORDS.includes(w))
  const isTopicMatch = (r: ContentResult) => {
    if (topicWords.length === 0) return false
    const text = `${r.title || ''} ${r.body || ''}`.toLowerCase()
    return topicWords.some(word => text.includes(word))
  }

  return results.filter(r => {
    const resultCategory = r.category || 'facts'

    // Keep any result that directly mentions the query topic, whatever its category
    if (isTopicMatch(r)) return true

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
 * Build a direct, deterministic answer from primary matches instead of
 * asking the LLM to reinterpret them. This guarantees that if we have
 * clear matches like "Kegger" or "Formal", we surface them instead of
 * getting a "no information" style hallucination.
 */
/**
 * Use LLM to filter and format relevant results
 */
async function filterAndFormatResultsWithLLM(
  query: string,
  allResults: Array<ContentResult & { category?: ContentCategory; source?: 'content' | 'announcement' | 'poll'; sentDate?: Date; eventDate?: Date }>,
  targetCategories: ContentCategory[],
  // Topic-resolved query used for category filtering (may differ from the user's
  // literal wording for pronoun follow-ups); the answer still addresses `query`
  filterQuery: string = query,
  // The user's ORIGINAL wording, insults and all — so the answer can react to tone
  // (a rude "what do you know, fuckface" earns a one-line jab THEN the real info)
  rawMessage: string = query,
  // Compact recent transcript so the answer is conversationally aware — mainly to
  // NOTICE when this same thing was just asked and not repeat the block verbatim.
  recentHistory: string = ''
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

    // UCLA quarter calendar (approx): summer break runs mid-June → late September, when
    // the org is mostly dormant. Lets the answer infer "it's summer, things are quiet"
    // instead of dredging up stale announcements to manufacture activity.
    const m = today.getMonth(), d = today.getDate()
    const isSummerBreak = (m === 5 && d >= 14) || m === 6 || m === 7 || (m === 8 && d < 24)
    const academicContext = isSummerBreak
      ? "It's UCLA SUMMER BREAK — the org is mostly dormant, people are away, little is actively scheduled. If someone asks what's going on and there's no genuinely current/upcoming item, the honest answer is it's summer and things are quiet. Do NOT resurface weeks-old announcements to fake activity."
      : "UCLA is in session (normal quarter) — regular org activity is expected."

    // Filter results by target categories (keeping direct topic matches regardless of category)
    const filteredResults = filterResultsByCategories(allResults, targetCategories, filterQuery)
    
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

      // Extract links from EVERYWHERE a URL can hide for this fact — not just sourceText.
      // Signup/RSVP URLs frequently live only in `entities` or the summarized body, so
      // scanning sourceText alone silently dropped them (the "no urls" bug).
      const linkPool = [r.body, ...(r.entities || []), r.sourceText || ''].filter(Boolean).join('\n')
      if (linkPool) {
        const slackLinkPattern = /<https?:\/\/([^>|]+)(\|[^>]*)?>/gi
        const regularUrlPattern = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi

        const urls: string[] = []
        let match
        while ((match = slackLinkPattern.exec(linkPool)) !== null) {
          const u = `https://${match[1]}`
          if (!urls.includes(u)) urls.push(u)
        }
        const allUrls = linkPool.match(regularUrlPattern) || []
        for (const url of allUrls) {
          if (!urls.includes(url)) urls.push(url)
        }

        if (urls.length > 0) {
          // Always show links prominently, especially if query mentions "link"
          const queryLower = query.toLowerCase()
          const isLinkQuery = queryLower.includes('link') || queryLower.includes('url') || queryLower.includes('rsvp')
          if (isLinkQuery) {
            resultText = `[${idx + 1}] ${r.source === 'announcement' ? '📢' : r.source === 'poll' ? '📊' : '📋'} ${r.title || 'Info'}${relevanceNote}\n${r.body}\n\n🔗 LINKS: ${urls.join('\n')}`
          } else {
            resultText += `\n🔗 Links: ${urls.join(', ')}`
          }
        }
      }

      // STRUCTURED SUB-DETAILS (batch-by-relation): when a fact groups several parallel
      // sub-items (per-city reunions, per-night rush events), each already carries its OWN
      // date + link, correctly matched. Hand the LLM the clean table so it presents every
      // one with the right date and the right url — no guessing, no dropped links.
      if (r.details && r.details.length > 0) {
        const lines = r.details.map(d => {
          const bits = [d.label]
          if (d.location && d.location !== d.label) bits.push(`(${d.location})`)
          if (d.date) bits.push(`— ${d.date}`)
          if (d.url) bits.push(`— RSVP/link: ${d.url}`)
          if (d.note) bits.push(`(${d.note})`)
          return `   • ${bits.join(' ')}`
        }).join('\n')
        resultText += `\nDETAILS (present ALL of these, each with its exact date and its own link):\n${lines}`
      }

      // Every parsed date for this entity — the whole point is the answer LLM should
      // see ALL of them (per-city reunion dates), not derive a wrong month from a lone
      // range-start dateStr. This is the fix for "in sep 2026" over July/Aug dates.
      if (r.calendarDates && r.calendarDates.length > 0) {
        resultText += `\nAll dates for this: ${r.calendarDates.join(', ')} (use these EXACT dates; do not summarize into a single month)`
      }

      // Include the full original text when it carries more detail than the summary —
      // 600 chars so a signup URL or per-city breakdown near the end isn't truncated off.
      if (r.sourceText && r.sourceText.length > r.body.length * 1.5 && !resultText.includes('Full details:')) {
        resultText += `\nFull details: ${r.sourceText.substring(0, 600)}${r.sourceText.length > 600 ? '...' : ''}`
      }

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

    const systemPrompt = `You are Jarvis, the org's assistant, answering a member's question over SMS using the provided search results.

VOICE — apply to every reply:
- lowercase, casual, tight. reads like a sharp friend texting back, not a customer-service bot
- lead with the answer in the first line. supporting details after, only if they earn their place
- ABSOLUTELY NO MARKDOWN: no **bold**, no headers, no bullet-point asterisks — SMS renders them as literal symbols. plain text, simple dashes for lists
- URLs must be passed through EXACTLY as they appear, on their own line or after a dash
- a dash of dry wit is welcome when it fits ("rsvp now or wander around lost, your call") but never at the cost of clarity
- TONE-MATCH: if the user's original message is rude or insulting (see "USER'S ACTUAL MESSAGE" below), open with ONE short, in-character jab that reacts to what they actually said, then give the full answer. Vary it — never reuse a stock opener. Never let the comeback replace or shorten the info. If the message is normal, no jab at all.
- REPEAT AWARENESS: check RECENT CONVERSATION below. If you ALREADY answered this same or a very similar question a moment ago, do NOT paste the same block again like a robot — call it out lightly and keep it short: "still every wednesday at 8, hasn't moved" / "same as two seconds ago — july 15" / "asked and answered, but sure: ...". Give the key detail (and any link) again, just don't re-dump the whole thing verbatim. Vary how you acknowledge it each time. If they've asked THREE+ times, you can be a touch more amused about it.

DATE FIDELITY (highest priority): reproduce every date EXACTLY as it appears in the result body or its "Sent on"/Event date line — never change the month, day, or year, and never let "weekend of" shift a month. If two results give different dates for one named event, present BOTH and label which is upcoming relative to today; never average, guess, or silently pick one.
NO INVENTED MONTHS: never write a month or season ("in sep 2026", "this september", "fall 2026") unless that month LITERALLY appears in the results. When an event spans multiple dates, either list the dates or state the real span ("july–august 2026") computed from the actual dates — never collapse them into a single month header. (Also: the org's name is SEP — if you mention it, write it uppercase "SEP", never "sep", which reads as September.)
FULL-INFO REQUESTS: when the user asks for "the full info", "all the details", "everything about X", or complains they didn't get something ("you didn't give me the links"), give the COMPLETE picture in one reply — every date, location, and EVERY link in the results. Holding links back on a full-info request is a failure.

TOPIC FIDELITY / NO FILLER: answer ONLY the specific thing asked. If NO result is a primary match for the user's specific topic (e.g. they asked "when is soccer" but results are retreat/ski), do NOT pad the answer with those unrelated events — say in one line you don't have that specific info and offer to check with an admin. Never substitute a different event to look helpful.

LINK GROUNDING: if ANY result contains a URL for the asked-about event, you MUST return that exact URL. Only say there's no link when NO result contains one for that event. Never invent a link.
PLATFORM-NAME ACCURACY: if the user asks for a link to a SPECIFIC platform ("discord link", "slack link", "google form"), check the URL's actual domain before answering. A url containing "slack.com" is a Slack link, "discord.gg"/"discord.com" is Discord, "forms.google.com"/"docs.google.com" is a Google Form, "luma.com" is Luma — NEVER call a link by a platform name its domain doesn't match, even to be helpful. If the only link you have is the wrong platform, say plainly "i don't have a discord link, but here's [what you have]: <url>" — do not say "here's the discord link" while giving a non-discord URL.

PRIMARY MATCHES:
- There are ${primaryResultsCount} results that directly mention the main topic words from the user's question (${topicWords.join(', ') || 'none'}).
- Any result marked with [PRIMARY_MATCH] is directly about what the user asked (e.g., an announcement that literally mentions "soccer").
- You MUST base your answer on PRIMARY_MATCH results first if any exist, before considering other results.
- When several results share an event name, list each with its date, LEAD with the soonest upcoming as the answer, and mark past instances as past.

CRITICAL: If PRIMARY_MATCH results are provided, use them. But if the results only tangentially relate (no primary match for the specific topic asked), it is correct to say you don't have that specific info rather than forcing an unrelated answer.

TODAY'S CONTEXT:
- Today is ${todayDayName}, ${todayStr}
- Use this to calculate relative dates and determine when recurring events occur next

LENGTH (important): keep it to a normal text — 2-4 short sentences, aim under ~400 characters. The ONLY reason to run longer is a genuine list where each line carries its own distinct date+link (like per-city RSVP links). Never pad, never over-explain, never restate a point twice.

RECENCY: every announcement shows a "Sent on" date. Do NOT present a weeks-old announcement — an old canceled meeting, a passed deadline — as if it's current news. If its date has already passed, it's history: mention it only if directly asked, and label it as past. A "what's going on" answer leans on genuinely current/upcoming items, not stale ones.

ACADEMIC CALENDAR: ${academicContext}

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

RECURRING-EVENT AUTHORITY (critical — this is the #1 source of wrong dates):
- A RECURRING result carries a pre-calculated "Next occurrence: <day> (<when>)" line. That line is ALWAYS correct and ALWAYS wins.
- IGNORE relative-date words like "tomorrow"/"tonight"/"this week" found INSIDE an old announcement's raw text when answering "when is the next X" — those words describe when THAT announcement was sent, not today. Multiple past announcements about the same recurring event will each say "tomorrow" relative to their own send date; picking any of them instead of the "Next occurrence" line gives a different wrong answer every time.
- Only use an announcement's relative-date text to explain HISTORY ("the meeting on July 7 was announced as happening 'tomorrow'"), never to answer "when is the next one."

WEEK-OF-TERM EVENTS:
- Some events or facts may be labeled by week, like "Week 1", "Week 2", "Week 3", etc.
- Treat these as an ordered sequence of weeks in a term or quarter.
- When summarizing or listing them (e.g., multiple week cards), present them in ascending week order: Week 1, Week 2, Week 3, Week 4, Week 5, and so on.

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
16. CRITICAL: If a result includes "🔗 Links:" or "🔗 LINKS:" sections, ALWAYS extract and include those URLs/links in your response
17. When user asks for links (e.g., "RSVP link", "registration link", "what's the link"), you MUST include the links from the results that have them
18. Links are marked with 🔗 emoji - if you see "🔗 LINKS:" or "🔗 Links:", those are the exact URLs to provide
19. If a result has links, include them in your response even if the content doesn't explicitly mention them
20. For queries asking specifically about links, prioritize results that have the 🔗 Links: section

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
      model: TEXTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Question: "${query}"${rawMessage !== query ? `\nUSER'S ACTUAL MESSAGE (react to this tone): "${rawMessage}"` : ''}${recentHistory ? `\n\nRECENT CONVERSATION (for repeat-awareness — did you already answer this?):\n${recentHistory}` : ''}${categoryInfo}\n\nSearch Results (${filteredResults.length} results found - these results ARE relevant to your query):\n${formattedResults}\n\nCRITICAL INSTRUCTIONS:
- These ${filteredResults.length} search results were found by searching the knowledge base for "${query}"
- If a result mentions the topic from your question (e.g., "study hall", "ae summons"), it IS relevant and you MUST use it
- Even if information is incomplete (e.g., "TBD", no date), still provide what IS available
- DO NOT say "no information available" or "I don't have that information" when ${filteredResults.length} results are provided
- Use the Category metadata to understand time directionality and filter appropriately
- Extract and present the information from these results to answer the question\n\nAnswer in jarvis's voice: lowercase, casual, short, plain text (no markdown), answer first:` }
      ],
      temperature: 0, // date fidelity — never let sampling shift a month/day/year
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
 * Resolve a vague / pronoun-only follow-up ("when are they", "where is it",
 * "hello when are they") into a self-contained query by inheriting the subject from
 * the recent conversation. LLM-based so it handles pronouns, greetings, and topic
 * shifts ("what about X" keeps X, doesn't inherit) without brittle patterns.
 * Returns the message unchanged when it already carries its own subject or when
 * there's nothing to inherit.
 */
export async function resolveVagueFollowUp(
  message: string,
  recentMessages?: Array<{ direction: 'inbound' | 'outbound'; text: string; createdAt: Date; meta?: unknown }>
): Promise<string> {
  if (!recentMessages || recentMessages.length === 0) return message
  if (!process.env.OPENAI_API_KEY) return message

  // Build a short transcript of the recent turns for context
  const transcript = recentMessages
    .slice(-6)
    .map(m => `${m.direction === 'inbound' ? 'User' : 'Jarvis'}: ${(m.text || '').slice(0, 200)}`)
    .join('\n')

  try {
    const { getOpenAI } = await import('@/lib/openai')
    const openai = getOpenAI()
    const res = await openai.chat.completions.create({
      model: HELPER_MODEL,
      messages: [
        {
          role: 'system',
          content: `You rewrite a member's latest SMS into a SELF-CONTAINED search query by resolving pronouns and vague references from the recent conversation.

RULES:
- If the message already names its own subject ("when is the formal"), return it UNCHANGED.
- If it's vague — a pronoun ("when are they", "where is it"), or a bare "when?"/"where?" — replace the vague part with the concrete subject from the most recent relevant earlier turn.
- SUBJECT-LESS REQUESTS inherit the topic just like pronouns: "give me links" / "give me the full info" / "send me that" / "you didn't give me my links" right after a conversation about the alumni reunion → "alumni reunion rsvp links" / "alumni reunion full details". The thing they want links/info FOR is whatever was just being discussed.
- Strip insults/profanity — they carry no search meaning: "fuck you give me the full info" → resolve "give me the full info" against the recent topic.
- Strip a leading greeting ("hello when are they" → resolve "when are they").
- "what about X" / "how about X" is a TOPIC SHIFT to X — keep X as the subject, do NOT inherit the previous topic.
- If nothing in the conversation gives a clear subject to inherit, return the message UNCHANGED.
- Output ONLY the rewritten query text, nothing else.`
        },
        {
          role: 'user',
          content: `Recent conversation:\n${transcript}\n\nLatest message: "${message}"\n\nSelf-contained query:`
        }
      ],
      temperature: 0,
      max_tokens: 60
    })
    const resolved = res.choices[0].message.content?.trim().replace(/^["']|["']$/g, '') || message
    return resolved.length > 0 ? resolved : message
  } catch (error) {
    console.error('[ContentQuery] Vague follow-up resolution failed, using original:', error)
    return message
  }
}

/**
 * Compose an in-voice overview of what's in the knowledge base — for "what info do
 * you know" style questions. Shows a sampler of REAL topics so the person learns what
 * they can actually ask, instead of getting the last answer replayed at them.
 */
async function composeKnowledgeOverview(message: string, topics: string[]): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null
  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await openai.chat.completions.create({
      model: TEXTER_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are Jarvis, the org's SMS assistant. Someone asked what info you know. Below are REAL topics currently in your knowledge base. Reply in your voice — lowercase, casual, dry — with a SHORT sampler: name ~4-5 of the most useful things you can answer about (e.g. events, meetings, deadlines) in ONE or TWO tight sentences, and say they can ask about any of it. KEEP IT UNDER ~350 CHARACTERS — this is a taste, not an inventory dump, not a wall of text. Plain text, no markdown. End with a brief in-character nudge, not "how can i help".

If their message was rude or insulting, open with ONE short in-character jab that reacts to what they actually said (vary it, no stock line) then give the sampler anyway. If it was normal, skip the jab.

KNOWN TOPICS:
${topics.slice(0, 60).join(', ')}`
        },
        { role: 'user', content: message }
      ],
      temperature: 0.6,
      max_tokens: 200
    })
    return res.choices[0].message.content?.trim() || null
  } catch (error) {
    console.error('[ContentQuery] Overview composition failed:', error)
    return null
  }
}

/**
 * Handle content query action
 * Searches content database, events, and past announcements/polls, then uses LLM to filter and format results.
 */
export async function handleContentQuery(input: ContentQueryInput): Promise<ActionResult> {
  const { phone, message, searchContent, searchEvents, recentMessages, searchPastActions, listKnownTopics } = input

  console.log(`[ContentQuery] Processing query: "${message}"`)

  // Category detection and vague-resolution are independent — run them in PARALLEL so
  // the hot path pays for one round-trip, not two. (resolveVagueFollowUp returns
  // instantly with no LLM call when there's no history to fold in.)
  const [earlyDetection, resolvedMessage] = await Promise.all([
    detectQueryCategories(message),
    resolveVagueFollowUp(message, recentMessages)
  ])
  if (resolvedMessage !== message) {
    console.log(`[ContentQuery] Resolved vague query "${message}" → "${resolvedMessage}"`)
  }

  // OVERVIEW ("what info do you know") — must run BEFORE the follow-up heuristic, which
  // otherwise hijacks it and replays the last answer. They're asking about the SCOPE of
  // the knowledge base, so show a sampler of real topics, not a repeat of the last reply.
  if (earlyDetection.isOverview && listKnownTopics) {
    try {
      const topics = await listKnownTopics()
      if (topics.length > 0) {
        const overview = await composeKnowledgeOverview(message, topics)
        if (overview) return { action: 'content_query', response: overview }
      }
    } catch (error) {
      console.error('[ContentQuery] Overview failed, falling through to search:', error)
    }
  }

  // Check if asking about recent actions first (highest priority)
  const recentAction = checkRecentActions(message, recentMessages)
  if (recentAction?.kind === 'recap') {
    console.log(`[ContentQuery] Recapping recent announcement`)
    // Return the recap as-is — it already quotes the real content. Wrapping it in
    // applyPersonality glued on sass prefixes ("okay okay ... there you go").
    return {
      action: 'content_query',
      response: recentAction.text
    }
  }
  if (recentAction?.kind === 'followup') {
    console.log(`[ContentQuery] Answering follow-up grounded in ${recentAction.announcements.length} recent announcement(s)`)
    const followUpAnswer = await answerAnnouncementFollowUp(message, recentAction.announcements)
    if (followUpAnswer) {
      return { action: 'content_query', response: followUpAnswer }
    }
  }
  
  // Reuse the parallel detection; only re-detect if vague-resolution actually rewrote
  // the query (rare — pronoun follow-ups), where the rewritten subject changes categories.
  const { categories: targetCategories, reasoning } =
    resolvedMessage === message ? earlyDetection : await detectQueryCategories(resolvedMessage)
  console.log(`[ContentQuery] Target categories: ${targetCategories.join(', ')} (${reasoning})`)
  
  // Collect all results from all sources
  const allResults: Array<ContentResult & { source?: 'content' | 'announcement' | 'poll'; sentDate?: Date; eventDate?: Date }> = []
  
  // 1. Search content database (Facts)
  // Search broadly and let categorization + LLM processing handle filtering
  // For link queries, always search all categories to find events with links
  const isLinkQuery = message.toLowerCase().includes('link') || message.toLowerCase().includes('rsvp') || message.toLowerCase().includes('url')
  const categoriesToSearch: ContentCategory[] = isLinkQuery
    ? ['facts', 'upcoming', 'recurring', 'past'] as ContentCategory[] // Search all categories for link queries
    : targetCategories

  // Fire all three sources CONCURRENTLY — they're independent, so this costs one
  // round-trip of latency instead of three. Each returns [] when not applicable or on error.
  type PastAction = { type: 'announcement' | 'poll'; content: string; sentAt: Date; sentBy: string }
  const wantFacts = !!searchContent && (categoriesToSearch.includes('facts') || categoriesToSearch.includes('upcoming') || categoriesToSearch.includes('recurring') || categoriesToSearch.includes('past'))
  const wantEvents = !!searchEvents && (targetCategories.includes('upcoming') || targetCategories.includes('past'))
  const contentSearchP: Promise<ContentResult[]> = wantFacts
    ? searchContent!(resolvedMessage).catch(err => { console.error('[ContentQuery] Content search failed:', err); return [] })
    : Promise.resolve([])
  const eventsSearchP: Promise<EventResult[]> = wantEvents
    ? searchEvents!().catch(err => { console.error('[ContentQuery] Event search failed:', err); return [] })
    : Promise.resolve([])
  const pastActionsP: Promise<PastAction[]> = searchPastActions
    ? searchPastActions().catch(err => { console.error('[ContentQuery] Past actions failed:', err); return [] })
    : Promise.resolve([])

  if (wantFacts) {
    try {
      const contentResults = await contentSearchP
      console.log(`[ContentQuery] Found ${contentResults.length} content results for "${resolvedMessage}"`)
      
      // Categorize deterministically first; batch the few results whose body needs an
      // LLM recurring-check into ONE call (was one call PER result — the fan-out).
      const withSyncCat = contentResults.map(r => ({ r, cat: categorizeResultSync({ ...r, source: 'content' }) }))
      const ambiguous = withSyncCat.filter(x => x.cat === null)
      const recurringFlags = await batchDetectRecurring(ambiguous.map(x => x.r.body || ''))
      let ambigIdx = 0
      const categorizedResults = withSyncCat.map(({ r, cat }) => {
        const category: ContentCategory = cat !== null
          ? cat
          : (recurringFlags[ambigIdx++] ? 'recurring' : categorizeByDate(r))
        console.log(`[ContentQuery] Categorized result: "${r.title || 'untitled'}" as ${category} (dateStr: ${r.dateStr}, timeRef: ${r.timeRef})`)
        return {
          ...r,
          source: 'content' as const,
          category,
          dateStr: r.dateStr || null,
          timeRef: r.timeRef || null
        }
      })
      
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
  
  // 2. Events (already running concurrently)
  if (wantEvents) {
    try {
      const events = await eventsSearchP
      console.log(`[ContentQuery] Found ${events.length} events`)
      const eventResults = events.map(eventToContentResult)
      allResults.push(...eventResults)
    } catch (error) {
      console.error('[ContentQuery] Event search failed:', error)
    }
  }

  // 3. Past announcements/polls (already running concurrently)
  if (searchPastActions) {
    try {
      const pastActions = await pastActionsP
      console.log(`[ContentQuery] Found ${pastActions.length} past actions`)
      
      // Cheap heuristic (was an LLM call): broad "what's going on / what did you send /
      // recent updates" asks are meta-queries that should pull in all recent announcements.
      const isMetaQuery = /\b(going on|happening|what'?s new|everything|all (the )?(announcements?|updates?)|what did you (send|announce|post)|recent(ly)?|latest|updates?)\b/i.test(message)
      console.log(`[ContentQuery] Is meta query (heuristic): ${isMetaQuery}`)
      
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
  
  // (Event↔announcement association enrichment removed — it cost a sequential LLM call
  //  for marginal gain; the answer LLM already sees every result together and can relate
  //  them itself.)

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
  
  // If no results, return no results message (already in-voice; no sass-wrap)
  if (allResults.length === 0) {
        return {
          action: 'content_query',
          response: TEMPLATES.noResults()
        }
      }
      
  // For link queries, don't filter by category - include all results that have links
  const categoriesForFiltering: ContentCategory[] = isLinkQuery 
    ? ['facts', 'upcoming', 'recurring', 'past', 'announcements', 'polls'] as ContentCategory[]
    : targetCategories
  
  // Cap what the answer LLM sees: results are already sorted by category priority then
  // score, so the top ~14 hold everything relevant. A smaller prompt = a faster final
  // call (the single biggest latency cost left), without dropping the real answer.
  const topResults = allResults.slice(0, 14)

  // Compact recent transcript so the answer can notice repeat questions and not re-dump
  // the same block verbatim. Last few turns, truncated — keeps the prompt cheap.
  const recentHistory = (recentMessages || [])
    .slice(-6)
    .map(m => `${m.direction === 'inbound' ? 'User' : 'Jarvis'}: ${(m.text || '').slice(0, 180)}`)
    .join('\n')

  // Use LLM to filter and format the most relevant results
  console.log(`[ContentQuery] Filtering and formatting ${topResults.length} of ${allResults.length} results with LLM (target categories: ${categoriesForFiltering.join(', ')}, isLinkQuery: ${isLinkQuery})...`)
  // Use the resolved query throughout so a pronoun follow-up ("when are they")
  // both keeps topic matches AND tells the answerer what subject to answer about
  const formattedResponse = await filterAndFormatResultsWithLLM(resolvedMessage, topResults, categoriesForFiltering, resolvedMessage, message, recentHistory)
  console.log(`[ContentQuery] Result: ${formattedResponse.substring(0, 50)}...`)
  
  // The formatter LLM already writes in jarvis's voice — wrapping it in
  // applyPersonality again glued sass prefixes onto formal text ("okay okay You need...")
  return {
    action: 'content_query',
    response: formattedResponse
  }
}

/**
 * Check if the query is asking about or following up on recent actions.
 * Uses a combination of pattern matching and context analysis to detect:
 * 1. Explicit questions about sent messages ("what did you send")
 * 2. Follow-up questions about recent announcements ("what dat mean", "huh", "tell me more")
 * 3. Conversational corrections referencing announcements ("no about janak's thing")
 *
 * Returns the announcement content as context string, or null if not a follow-up.
 */
type RecentActionMatch =
  | { kind: 'recap'; text: string }
  | { kind: 'followup'; announcements: string[] }

function checkRecentActions(
  message: string,
  recentMessages?: Array<{
    direction: 'inbound' | 'outbound'
    text: string
    createdAt: Date
    meta?: { action?: string; draftContent?: string } | null
  }>
): RecentActionMatch | null {
  if (!recentMessages || recentMessages.length === 0) return null

  const lower = message.toLowerCase().trim()
  const isAskingAboutSent = /\b(what did|what have) (you|i) (just )?(send|sent|say|said|announce|do|did)\b/i.test(lower)
  const isAskingAboutAnnouncement = /\bwhat (was|is) (that|the) (announcement|message|poll|text|reminder)\b/i.test(lower)

  // Broad follow-up detection: short/vague messages that are likely referencing
  // the most recent outbound message rather than being standalone queries.
  const isFollowUpQuestion =
    // Explicit follow-up phrases
    /\b(tell me more|more info|details|about what|explain|elaborate)\b/i.test(lower) ||
    // Short confused replies (under 30 chars and contains a question-like word)
    (lower.length < 30 && /\b(what|huh|wut|wat|wdym|meaning|mean|means|why|how)\b/i.test(lower)) ||
    // "what's this/that" style
    /\bwhat'?s?\s+(this|that|it)\b/i.test(lower) ||
    // Deictic choice questions about something just shown ("which one should i click",
    // "the second one?", "is that one in la?")
    /\b(which one|this one|that one|the (first|second|third|last) one)\b/i.test(lower) ||
    // Conversational corrections ("no about X", "no I meant X", "not that, about X")
    /^(no|nah|nope|not that)[,.]?\s+(about|i meant|i mean|i'm asking|the|tell me about)\b/i.test(lower) ||
    // Reference to specific content in a recent announcement ("about janak", "the laptop thing", "reunion links")
    false // placeholder - specific content matching happens below

  // Find a recent announcement in conversation history
  const recentAnnouncement = findRecentAnnouncement(recentMessages)

  if (recentAnnouncement) {
    // Check if the user's message references specific content from the announcement
    // e.g., announcement mentions "janak" and user says "no about janak's thing"
    // Only match distinctive words (5+ chars, not common verbs/adjectives) to avoid
    // false positives on casual conversational replies like "I'd rather listen to you"
    const announcementLower = recentAnnouncement.toLowerCase()
    const userWords = lower.split(/\s+/).filter(w => w.length > 4) // 5+ chars only
    const commonWords = new Set([
      'the', 'and', 'for', 'are', 'what', 'when', 'where', 'how', 'who', 'why',
      'can', 'does', 'will', 'about', 'with', 'that', 'this', 'not', 'tell', 'send',
      'more', 'mean', 'means', 'meaning', 'thing', 'stuff', 'info', 'yes', 'yeah',
      'nope', 'there', 'their', 'would', 'could', 'should', 'think', 'going', 'doing',
      'being', 'every', 'never', 'always', 'really', 'right', 'still', 'rather',
      'listen', 'people', 'looking', 'getting', 'coming', 'saying', 'making',
      'stupid', 'great', 'other', 'today', 'tomorrow', 'tonight',
    ])
    const referencesAnnouncementContent = userWords.some(word => {
      if (commonWords.has(word)) return false
      return announcementLower.includes(word)
    })

    // Only treat as follow-up if user is actually asking/requesting, not just reacting
    const looksLikeReaction = /^(lol|lmao|haha|wow|nice|cool|ok|damn|true|facts|bet|fr|yikes)/i.test(lower) ||
      /^(i('d| would| rather| don'?t| can'?t| think| love| hate| feel|'m|'ll))\b/i.test(lower)

    if (isAskingAboutSent || isAskingAboutAnnouncement) {
      return { kind: 'recap', text: `here's the announcement that was sent: "${recentAnnouncement}"` }
    }
    if (isFollowUpQuestion || (referencesAnnouncementContent && !looksLikeReaction)) {
      // Gate on the 5-message window, but give the answerer deeper context —
      // "the LA one" often refers to a broadcast a few messages further back
      return { kind: 'followup', announcements: findRecentAnnouncements(recentMessages, 10) }
    }
  }

  if (!isAskingAboutSent && !isAskingAboutAnnouncement) return null

  // Look for recent draft_send actions in the last few messages
  for (let i = recentMessages.length - 1; i >= Math.max(0, recentMessages.length - 5); i--) {
    const msg = recentMessages[i]

    if (msg.meta?.action === 'draft_send' && msg.direction === 'outbound') {
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const prevMsg = recentMessages[j]

        // Draft previews always quote the content ("here's what i've got: \"...\"",
        // "updated: \"...\"", "📝 draft's ready: \"...\"") — extract the quoted text
        // rather than matching one template's exact wording
        if (prevMsg.direction === 'outbound' && (prevMsg.meta?.action === 'draft_write' || /draft|announcement|updated|version|got/i.test(prevMsg.text))) {
          const match = prevMsg.text.match(/"([^"]+)"/);
          if (match && match[1]) {
            return { kind: 'recap', text: `i just sent out: "${match[1]}"` }
          }
        }

        if (prevMsg.meta?.draftContent) {
          return { kind: 'recap', text: `i just sent out: "${prevMsg.meta.draftContent}"` }
        }
      }

      return { kind: 'recap', text: `i just sent out an announcement. check your messages` }
    }
  }

  return null
}

/**
 * Find the most recent announcement in conversation history.
 * Matches all announcement action types: scheduled_announcement, announcement, draft_send.
 * Returns the full text content if found within the last 5 outbound messages.
 */
function findRecentAnnouncement(
  recentMessages: Array<{
    direction: 'inbound' | 'outbound'
    text: string
    createdAt: Date
    meta?: { action?: string; draftContent?: string } | null
  }>
): string | null {
  return findRecentAnnouncements(recentMessages)[0] ?? null
}

/**
 * Collect up to 3 recent announcements, most recent first — a follow-up like
 * "what's the link for the LA one?" often targets an older broadcast, not the latest.
 */
function findRecentAnnouncements(
  recentMessages: Array<{
    direction: 'inbound' | 'outbound'
    text: string
    createdAt: Date
    meta?: { action?: string; draftContent?: string } | null
  }>,
  window = 5
): string[] {
  const announcementActions = ['scheduled_announcement', 'announcement', 'poll']
  const found: string[] = []
  for (let i = recentMessages.length - 1; i >= Math.max(0, recentMessages.length - window) && found.length < 3; i--) {
    const msg = recentMessages[i]
    if (
      msg.direction === 'outbound' &&
      msg.meta?.action &&
      announcementActions.includes(msg.meta.action) &&
      msg.text?.trim()
    ) {
      found.push(msg.text.trim())
      continue
    }
    // draft_send stores content in meta.draftContent
    if (
      msg.direction === 'outbound' &&
      msg.meta?.action === 'draft_send' &&
      msg.meta?.draftContent?.trim()
    ) {
      found.push(msg.meta.draftContent.trim())
    }
  }
  return found
}

/**
 * Answer a follow-up question grounded in the recent announcements.
 * Falls back to quoting the latest announcement when the LLM is unavailable.
 */
async function answerAnnouncementFollowUp(
  message: string,
  announcements: string[]
): Promise<string | null> {
  if (announcements.length === 0) return null

  const fallback = `here's the announcement that was sent: "${announcements[0]}"`
  if (!process.env.OPENAI_API_KEY) return fallback

  try {
    const { getOpenAI } = await import('@/lib/openai')
    const openai = getOpenAI()

    const response = await openai.chat.completions.create({
      model: TEXTER_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are Jarvis, the org's assistant, texting over SMS. The user is asking a follow-up about announcements the org recently sent.

RECENT ANNOUNCEMENTS (most recent first):
${announcements.map((a, i) => `${i + 1}. "${a}"`).join('\n')}

RULES:
- answer their question using ONLY the announcement content above. figure out which announcement they mean from their wording
- copy links, dates, names, and amounts EXACTLY as written — never invent or alter them
- lowercase, casual, tight — like a sharp friend texting back. no markdown
- if the announcements don't actually contain the answer, say so plainly and suggest asking an admin — do not guess`
        },
        { role: 'user', content: message }
      ],
      temperature: 0.6,
      max_tokens: 200
    })

    return response.choices[0].message.content || fallback
  } catch (error) {
    console.error('[ContentQuery] Follow-up answer failed, using fallback:', error)
    return fallback
  }
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

