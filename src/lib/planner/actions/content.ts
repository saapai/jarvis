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
}

export interface ContentResult {
  title: string
  body: string
  score: number
}

/**
 * Handle content query action
 * Note: In MVP, this returns a placeholder. Will integrate with actual search.
 */
export async function handleContentQuery(input: ContentQueryInput): Promise<ActionResult> {
  const { phone, message, userName, searchContent, recentMessages } = input
  
  console.log(`[ContentQuery] Processing query: "${message}"`)
  
  // Check if asking about recent actions first
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
  
  // If search function is provided, use it
  if (searchContent) {
    console.log(`[ContentQuery] Searching content database...`)
    try {
      const results = await searchContent(message)
      console.log(`[ContentQuery] Found ${results.length} results`)
      
      if (results.length === 0) {
        return {
          action: 'content_query',
          response: applyPersonality({
            baseResponse: TEMPLATES.noResults(),
            userMessage: message,
            userName
          })
        }
      }
      
      // If query is vague, provide a concise summary across top results
      if (isVagueQuery(message) && results.length > 1) {
        const summary = summarizeResults(results.slice(0, 3))
        return {
          action: 'content_query',
          response: applyPersonality({
            baseResponse: summary,
            userMessage: message,
            userName
          })
        }
      }
      
      // Format top result as response
      const topResult = results[0]
      const response = formatContentResponse(topResult, message)
      console.log(`[ContentQuery] Returning top result: ${response.substring(0, 50)}...`)
      
      return {
        action: 'content_query',
        response: applyPersonality({
          baseResponse: response,
          userMessage: message,
          userName
        })
      }
    } catch (error) {
      console.error('[ContentQuery] Search failed:', error)
      return {
        action: 'content_query',
        response: applyPersonality({
          baseResponse: "something went wrong searching. try again?",
          userMessage: message,
          userName
        })
      }
    }
  }
  
  // No search function - return placeholder
  console.log(`[ContentQuery] No search function available`)
  return {
    action: 'content_query',
    response: applyPersonality({
      baseResponse: "content search not set up yet. ask your admin to connect a knowledge base",
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
  
  // If body is short, return it directly
  if (body.length < 200) {
    return body
  }
  
  // Try to extract the most relevant part
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  
  // Find sentence containing query words
  const sentences = body.split(/[.!?]+/).filter(s => s.trim().length > 10)
  
  for (const word of queryWords) {
    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes(word)) {
        return sentence.trim() + '.'
      }
    }
  }
  
  // Fallback: return first 200 chars
  return body.substring(0, 200) + '...'
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

