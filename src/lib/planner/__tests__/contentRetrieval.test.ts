/**
 * Regression tests for content retrieval fixes:
 * - a fact that names the query topic must survive category filtering even with
 *   no parsed date (the "alumni reunion dates exist but aren't answered" bug)
 * - vague pronoun follow-ups ("when are they") must inherit the prior subject
 *
 * These exercise the two deterministic helpers directly (no LLM), so they're fast
 * and stable.
 */
import { filterResultsByCategories, resolveVagueFollowUp } from '../actions/content'

// Reproduces the production Alumni Reunion fact: real dates live in the body,
// but it has no parsed dateStr so it gets categorized as a plain "fact"
const reunionFact = {
  title: 'Alumni Reunion',
  body: 'The Alumni Reunion in New York is scheduled for August 1st, 2026. Los Angeles is July 17th. San Francisco is August 29th.',
  score: 0,
  category: 'facts' as const,
  dateStr: null,
  timeRef: 'coming soon'
}

const weeklyMeeting = {
  title: 'Weekly Meeting',
  body: 'chapter meeting every wednesday at 8pm',
  score: 0.4,
  category: 'recurring' as const,
  dateStr: 'recurring:wednesday',
  timeRef: 'every wednesday'
}

describe('filterResultsByCategories — topic matches survive category filtering', () => {
  test('keeps a dateless "facts" result when the query names its topic', () => {
    // "when are alumni reunions" only targets upcoming/recurring, which would
    // normally drop a facts-category result
    const out = filterResultsByCategories(
      [reunionFact, weeklyMeeting],
      ['upcoming', 'recurring'],
      'when are alumni reunions'
    )
    expect(out.map(r => r.title)).toContain('Alumni Reunion')
  })

  test('still drops off-topic results outside the target categories', () => {
    const offTopic = { title: 'Old Merch Order', body: 'spring shirt order closed', score: 0, category: 'past' as const, dateStr: null, timeRef: null }
    const out = filterResultsByCategories(
      [reunionFact, offTopic],
      ['upcoming', 'recurring'],
      'when are alumni reunions'
    )
    expect(out.map(r => r.title)).toContain('Alumni Reunion')
    expect(out.map(r => r.title)).not.toContain('Old Merch Order')
  })

  test('no query → falls back to pure category filtering', () => {
    const out = filterResultsByCategories([reunionFact, weeklyMeeting], ['recurring'])
    expect(out.map(r => r.title)).toEqual(['Weekly Meeting'])
  })
})

describe('resolveVagueFollowUp — pronoun follow-ups inherit prior subject (LLM-backed)', () => {
  const history = [
    { direction: 'inbound' as const, text: 'when are alumni reunions', createdAt: new Date() },
    { direction: 'outbound' as const, text: 'reunions are coming up soon', createdAt: new Date() },
    { direction: 'inbound' as const, text: 'when are they', createdAt: new Date() }
  ]

  test('"when are they" folds in the previous question subject', async () => {
    const resolved = (await resolveVagueFollowUp('when are they', history)).toLowerCase()
    expect(resolved).toMatch(/reunion|alumni/)
  }, 20000)

  test('a self-contained question is left untouched', async () => {
    const resolved = await resolveVagueFollowUp('when is the formal', history)
    expect(resolved.toLowerCase()).toContain('formal')
  }, 20000)

  test('no history → unchanged (no LLM call)', async () => {
    expect(await resolveVagueFollowUp('when are they', [])).toBe('when are they')
  })
})
