/**
 * Tests for checkRecentActions and findRecentScheduledAnnouncement
 * in content.ts — ensures users can converse about received announcements
 */

import { handleContentQuery } from '../planner/actions/content'

// Mock personality to pass through
jest.mock('../planner/personality', () => ({
  applyPersonality: ({ baseResponse }: { baseResponse: string }) => baseResponse,
  TEMPLATES: {
    noResults: () => 'no results found',
  },
}))

// Mock the OpenAI call used by detectQueryCategories / isCategoryQuery / etc.
const mockCreate = jest.fn()
jest.mock('@/lib/openai', () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }),
}))

function makeMessage(
  direction: 'inbound' | 'outbound',
  text: string,
  action?: string,
  minutesAgo = 0
): {
  direction: 'inbound' | 'outbound'
  text: string
  createdAt: Date
  meta: { action?: string; draftContent?: string } | null
} {
  return {
    direction,
    text,
    createdAt: new Date(Date.now() - minutesAgo * 60000),
    meta: action ? { action } : null,
  }
}

describe('checkRecentActions with scheduled_announcement', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns announcement content when user asks "what was that message"', async () => {
    const recentMessages = [
      makeMessage('outbound', 'Reminder: fill out the weekly survey by end of day today. https://forms.google.com/abc', 'scheduled_announcement', 5),
      makeMessage('inbound', 'what was that message', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what was that message',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('fill out the weekly survey')
    expect(result.action).toBe('content_query')
  })

  it('returns announcement content when user asks "what is that announcement"', async () => {
    const recentMessages = [
      makeMessage('outbound', 'Reminder: RSVP for the team dinner by Friday.', 'scheduled_announcement', 10),
      makeMessage('inbound', 'what is that announcement', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what is that announcement',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('RSVP')
    expect(result.response).toContain('team dinner')
  })

  it('returns announcement context for follow-up questions like "what\'s this"', async () => {
    const recentMessages = [
      makeMessage('outbound', 'Reminder: submit your project proposals for the Spring hackathon by end of day today.', 'scheduled_announcement', 3),
      makeMessage('inbound', "what's this", undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: "what's this",
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('project proposals')
    expect(result.response).toContain('hackathon')
  })

  it('returns announcement context for "tell me more" follow-ups', async () => {
    const recentMessages = [
      makeMessage('outbound', 'Reminder: vote in the team outing poll by EOD.', 'scheduled_announcement', 2),
      makeMessage('inbound', 'tell me more', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'tell me more',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('vote')
    expect(result.response).toContain('team outing poll')
  })

  it('returns announcement context for "huh" / confused replies', async () => {
    const recentMessages = [
      makeMessage('outbound', 'Reminder: fill out the feedback form for last week\'s speaker.', 'scheduled_announcement', 1),
      makeMessage('inbound', 'huh', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'huh',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('feedback form')
  })

  it('does NOT trigger for unrelated messages when no scheduled_announcement exists', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ categories: ['facts'], reasoning: 'general question' }) } }],
    })

    const recentMessages = [
      makeMessage('outbound', 'Hey! How are you?', 'chat', 5),
      makeMessage('inbound', 'what time is the meeting', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what time is the meeting',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).not.toContain('announcement that was sent')
  })

  it('ignores scheduled_announcement that is more than 5 messages back', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ categories: ['facts'], reasoning: 'general question' }) } }],
    })

    const recentMessages = [
      makeMessage('outbound', 'Reminder: old announcement', 'scheduled_announcement', 60),
      makeMessage('inbound', 'thanks', undefined, 55),
      makeMessage('outbound', 'np!', 'chat', 50),
      makeMessage('inbound', 'hey', undefined, 40),
      makeMessage('outbound', 'hello!', 'chat', 35),
      makeMessage('inbound', 'whats up', undefined, 30),
      makeMessage('outbound', 'not much!', 'chat', 25),
      makeMessage('inbound', 'what was that reminder about', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what was that reminder about',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).not.toContain('old announcement')
  })

  it('handles draft_send actions (existing behavior still works)', async () => {
    const recentMessages = [
      makeMessage('outbound', 'here\'s the announcement: "Team lunch Friday at noon"', 'draft_write', 5),
      makeMessage('inbound', 'send it', undefined, 3),
      makeMessage('outbound', 'sent!', 'draft_send', 2),
      makeMessage('inbound', 'what did you just send', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what did you just send',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('Team lunch Friday at noon')
  })

  it('prefers scheduled_announcement over draft_send if both exist', async () => {
    const recentMessages = [
      makeMessage('outbound', 'sent!', 'draft_send', 10),
      makeMessage('outbound', 'Reminder: submit code reviews by EOD.', 'scheduled_announcement', 2),
      makeMessage('inbound', 'what was that', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what was that',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('code reviews')
  })

  it('returns full content including URLs from scheduled announcement', async () => {
    const recentMessages = [
      makeMessage(
        'outbound',
        'Reminder: fill out the weekly survey by end of day today.\n\nhttps://forms.google.com/abc123',
        'scheduled_announcement',
        3
      ),
      makeMessage('inbound', 'what is this about', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what is this about',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('weekly survey')
    expect(result.response).toContain('https://forms.google.com/abc123')
  })

  it('handles "what is that text" query with scheduled announcement', async () => {
    const recentMessages = [
      makeMessage('outbound', 'Reminder: sign up for the mentorship program by Friday.', 'scheduled_announcement', 5),
      makeMessage('inbound', 'what is that text', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what is that text',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('mentorship program')
  })

  it('handles "what is that reminder" query', async () => {
    const recentMessages = [
      makeMessage('outbound', 'Reminder: complete the safety training module by next Monday.', 'scheduled_announcement', 5),
      makeMessage('inbound', 'what is that reminder', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what is that reminder',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('safety training')
  })
})
