/**
 * Tests for detectDeadline — the Slack-message → SMS-notification gate.
 *
 * Covers the three behaviors that produced the incomplete/late announcement:
 *  1. Only events & concrete actions notify; pure FYIs are skipped.
 *  2. Relative time is anchored to the org's Pacific day, not the UTC server day.
 *  3. Content keeps the actionable details (and the explicit Pacific offset parses
 *     correctly regardless of the machine's timezone).
 */

import { detectDeadline } from '../slackDeadline'
import { getOpenAI } from '../openai'

jest.mock('../openai', () => ({ getOpenAI: jest.fn() }))

const mockGetOpenAI = getOpenAI as jest.Mock

/** Wire up a mock OpenAI client that returns `payload` as the completion JSON. */
function mockLLM(payload: unknown) {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(payload) } }],
  })
  mockGetOpenAI.mockReturnValue({ chat: { completions: { create } } })
  return create
}

/** Unix-seconds ts for a given UTC instant. */
function tsUtc(y: number, m: number, d: number, h: number, min = 0): string {
  return (Date.UTC(y, m, d, h, min, 0) / 1000).toString()
}

// A far-future offset-stamped time, so the "in the past" guard never trips.
const FUTURE = '2099-06-24T09:00:00-07:00'

afterEach(() => jest.clearAllMocks())

describe('detectDeadline — notification gate', () => {
  test('skips pure FYI messages', async () => {
    mockLLM({ category: 'fyi', shouldNotify: false, scheduledFor: null, content: null })
    const result = await detectDeadline('the talk yesterday was awesome, thanks all', tsUtc(2025, 5, 22, 20))
    expect(result).toBeNull()
  })

  test('skips when shouldNotify is false even if a date is present', async () => {
    mockLLM({ category: 'fyi', shouldNotify: false, scheduledFor: FUTURE, content: 'x' })
    expect(await detectDeadline('fyi only', tsUtc(2025, 5, 22, 20))).toBeNull()
  })

  test('notifies for an event and returns the detailed content', async () => {
    mockLLM({
      category: 'event',
      shouldNotify: true,
      scheduledFor: FUTURE,
      content: 'Today Darren is chatting with Dillon Liang (Blueprint Finance) and Lance Ding (Startup Village). DM Darren any questions.',
    })
    const result = await detectDeadline('Tomorrow I am chatting with...', tsUtc(2025, 5, 22, 20), 'Darren')
    expect(result).not.toBeNull()
    expect(result!.content).toContain('Dillon Liang')
    expect(result!.content).toContain('Lance Ding')
    // Substance preserved, not reduced to a bare CTA.
    expect(result!.content).not.toBe('DM Darren any questions.')
  })

  test('notifies for a concrete action deadline', async () => {
    mockLLM({ category: 'action', shouldNotify: true, scheduledFor: FUTURE, content: 'RSVP to the mixer by EOD today.' })
    const result = await detectDeadline('rsvp to the mixer by EOD thurs', tsUtc(2025, 5, 22, 20))
    expect(result).not.toBeNull()
    expect(result!.content).toContain('RSVP')
  })
})

describe('detectDeadline — time handling', () => {
  test('parses the Pacific offset to the correct absolute UTC instant', async () => {
    mockLLM({ category: 'event', shouldNotify: true, scheduledFor: '2099-06-24T09:00:00-07:00', content: 'c' })
    const result = await detectDeadline('event tmr', tsUtc(2025, 5, 22, 20))
    // 09:00 PDT (-07:00) === 16:00 UTC — independent of the test machine's TZ.
    expect(result!.scheduledFor.toISOString()).toBe('2099-06-24T16:00:00.000Z')
  })

  test('anchors the message send-date to the Pacific day, not the UTC day', async () => {
    const create = mockLLM({ category: 'event', shouldNotify: true, scheduledFor: FUTURE, content: 'c' })
    // Jun 24 2025 04:00 UTC === Jun 23 2025 21:00 PDT (Monday night Pacific).
    await detectDeadline('chatting with someone tomorrow', tsUtc(2025, 5, 24, 4))
    const prompt: string = create.mock.calls[0][0].messages[1].content
    expect(prompt).toContain('June 23')   // Pacific day
    expect(prompt).toContain('Monday')     // Pacific weekday
    expect(prompt).not.toContain('June 24') // would be the (wrong) UTC day
  })

  test('returns null when the resolved time is in the past', async () => {
    mockLLM({ category: 'action', shouldNotify: true, scheduledFor: '2000-01-01T17:00:00-08:00', content: 'c' })
    expect(await detectDeadline('rsvp by eod', tsUtc(1999, 11, 31, 20))).toBeNull()
  })

  test('returns null when scheduledFor is missing', async () => {
    mockLLM({ category: 'event', shouldNotify: true, scheduledFor: null, content: 'c' })
    expect(await detectDeadline('event but no time', tsUtc(2025, 5, 22, 20))).toBeNull()
  })

  test('returns null when scheduledFor is unparseable', async () => {
    mockLLM({ category: 'event', shouldNotify: true, scheduledFor: 'not-a-date', content: 'c' })
    expect(await detectDeadline('event garbled time', tsUtc(2025, 5, 22, 20))).toBeNull()
  })
})

describe('detectDeadline — prompt construction', () => {
  test('strips URLs out of the text handed to the LLM', async () => {
    const create = mockLLM({ category: 'fyi', shouldNotify: false, scheduledFor: null, content: null })
    await detectDeadline('rsvp here https://example.com/form?a=1&b=2 by thurs', tsUtc(2025, 5, 22, 20))
    const prompt: string = create.mock.calls[0][0].messages[1].content
    expect(prompt).toContain('[link]')
    expect(prompt).not.toContain('example.com')
  })

  test('injects the third-person sender instruction when a name is given', async () => {
    const create = mockLLM({ category: 'fyi', shouldNotify: false, scheduledFor: null, content: null })
    await detectDeadline('I am hosting office hours thurs', tsUtc(2025, 5, 22, 20), 'Darren')
    const prompt: string = create.mock.calls[0][0].messages[1].content
    expect(prompt).toContain('Darren')
    expect(prompt).toContain('THIRD PERSON')
  })

  test('omits the sender instruction when no name is given', async () => {
    const create = mockLLM({ category: 'fyi', shouldNotify: false, scheduledFor: null, content: null })
    await detectDeadline('office hours thurs', tsUtc(2025, 5, 22, 20))
    const prompt: string = create.mock.calls[0][0].messages[1].content
    expect(prompt).not.toContain('THIRD PERSON')
  })
})

describe('detectDeadline — resilience', () => {
  test('falls back to the raw message when notify-worthy but content is empty', async () => {
    mockLLM({ category: 'event', shouldNotify: true, scheduledFor: FUTURE, content: null })
    const result = await detectDeadline('raw text here', tsUtc(2025, 5, 22, 20))
    expect(result!.content).toBe('raw text here')
  })

  test('returns null (never throws) when the LLM call fails', async () => {
    const create = jest.fn().mockRejectedValue(new Error('boom'))
    mockGetOpenAI.mockReturnValue({ chat: { completions: { create } } })
    expect(await detectDeadline('anything', tsUtc(2025, 5, 22, 20))).toBeNull()
  })

  test('returns null when the LLM returns invalid JSON', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'not json' } }] })
    mockGetOpenAI.mockReturnValue({ chat: { completions: { create } } })
    expect(await detectDeadline('anything', tsUtc(2025, 5, 22, 20))).toBeNull()
  })
})
