import type { ContentResult } from '@/lib/planner/actions/content'
import { searchFacts } from './search'

type Source = 'calendar' | 'docs' | 'slack' | 'facts'

function detectSource(query: string): Source {
  const lower = query.toLowerCase()
  if (/\b(calendar|event|invite|schedule)\b/.test(lower)) return 'calendar'
  if (/\b(doc|document|drive|file|note|notes)\b/.test(lower)) return 'docs'
  if (/\b(slack|channel|thread|dm)\b/.test(lower)) return 'slack'
  return 'facts'
}

/**
 * Route a content query to the appropriate data source.
 * Currently stubs calendar/docs/slack and defaults to facts.
 */
export async function routeContentSearch(query: string): Promise<ContentResult[]> {
  const source = detectSource(query)

  // Future integrations can branch here
  switch (source) {
    case 'calendar':
    case 'docs':
    case 'slack':
      // Stub: fall through to facts search until integrations are available
      return searchFacts(query)
    case 'facts':
    default:
      return searchFacts(query)
  }
}










