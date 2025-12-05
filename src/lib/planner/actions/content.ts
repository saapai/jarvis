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
  const { phone, message, userName, searchContent } = input
  
  // If search function is provided, use it
  if (searchContent) {
    try {
      const results = await searchContent(message)
      
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
      
      // Format top result as response
      const topResult = results[0]
      const response = formatContentResponse(topResult, message)
      
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

