/**
 * Content Query Handler
 * Handles questions about organization content (events, meetings, etc.)
 */

import { ActionResult } from '../types'
import { applyPersonality, TEMPLATES } from '../personality'

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
 * Use LLM to filter and format relevant results
 */
async function filterAndFormatResultsWithLLM(
  query: string,
  allResults: Array<{ title: string; body: string; score: number; source?: 'content' | 'announcement' | 'poll'; sentDate?: Date }>
): Promise<string> {
  if (!process.env.OPENAI_API_KEY || allResults.length === 0) {
    return allResults[0]?.body || TEMPLATES.noResults()
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    // Format results for LLM, including sent dates for relative date parsing
    const formattedResults = allResults.map((r, idx) => {
      let resultText = `[${idx + 1}] ${r.source === 'announcement' ? '📢' : r.source === 'poll' ? '📊' : '📋'} ${r.title || 'Info'}\n${r.body}`
      
      // Add context about sent date for relative date parsing
      if (r.sentDate && (r.source === 'announcement' || r.source === 'poll')) {
        const sentDate = r.sentDate instanceof Date ? r.sentDate : new Date(r.sentDate)
        const dateStr = sentDate.toISOString().split('T')[0]
        resultText += `\nNote: This was sent on ${dateStr}. When this mentions relative dates like "tomorrow", "tmr", "next week", calculate them relative to ${dateStr}, not today's date.`
      }
      
      return resultText
    }).join('\n\n')

    const systemPrompt = `You are a helpful assistant that answers questions using the provided search results.

IMPORTANT: For announcements and polls that include relative dates (e.g., "tomorrow", "tmr", "next week"), calculate these dates relative to the "sent on" date mentioned in the result, NOT today's date. For example, if an announcement was sent on January 6 and says "tomorrow", that means January 7.

Your task:
1. Filter out irrelevant results that don't answer the user's question
2. Combine relevant information from multiple results into a clear, concise answer
3. Focus on the most relevant details, ignoring extraneous information
4. If multiple results are relevant, synthesize them into one coherent answer
5. If no results are relevant, say you don't have that information

Format your response naturally and conversationally, as if texting. Keep it concise but complete.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Question: "${query}"\n\nSearch Results:\n${formattedResults}\n\nProvide a clear, concise answer based only on the relevant results above.` }
      ],
      temperature: 0.3,
      max_tokens: 300
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
  const allResults: Array<{ title: string; body: string; score: number; source?: 'content' | 'announcement' | 'poll'; sentDate?: Date }> = []
  
  // 1. Search content database
  if (searchContent) {
    console.log(`[ContentQuery] Searching content database...`)
    try {
      const contentResults = await searchContent(message)
      console.log(`[ContentQuery] Found ${contentResults.length} content results`)
      allResults.push(...contentResults.map(r => ({ ...r, source: 'content' as const })))
    } catch (error) {
      console.error('[ContentQuery] Content search failed:', error)
    }
  }
  
  // 2. Search past announcements/polls (always search, not just for past action queries)
  if (searchPastActions) {
    console.log(`[ContentQuery] Searching past announcements/polls...`)
    try {
      const pastActions = await searchPastActions()
      console.log(`[ContentQuery] Found ${pastActions.length} past actions`)
      
      // Convert past actions to content results format and filter by relevance
      const queryLower = message.toLowerCase()
      const relevantActions = pastActions
        .filter(action => {
          const contentLower = action.content.toLowerCase()
          const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2)
          return queryWords.some(word => contentLower.includes(word))
        })
        .map(action => {
          // Include sent date in the body for relative date parsing
          const sentDate = action.sentAt instanceof Date ? action.sentAt : new Date(action.sentAt)
          const dateStr = sentDate.toISOString().split('T')[0] // YYYY-MM-DD format
          return {
            title: action.type === 'poll' ? 'Poll' : 'Announcement',
            body: `${action.type === 'poll' ? '📊' : '📢'} ${action.content}${action.type === 'poll' ? '\n(Reply yes/no/maybe)' : ''}\n(Sent: ${dateStr})`,
            score: 0.5, // Medium relevance for past actions
            source: action.type === 'poll' ? 'poll' as const : 'announcement' as const,
            sentDate // Store for LLM context
          }
        })
      
      allResults.push(...relevantActions)
      console.log(`[ContentQuery] Found ${relevantActions.length} relevant past actions`)
    } catch (error) {
      console.error('[ContentQuery] Past actions search failed:', error)
    }
  }
  
  // Sort all results by score (highest first)
  allResults.sort((a, b) => b.score - a.score)
  
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

