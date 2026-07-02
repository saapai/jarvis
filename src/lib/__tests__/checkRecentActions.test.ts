/**
 * Tests for checkRecentActions and findRecentAnnouncement
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
  minutesAgo = 0,
  draftContent?: string
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
    meta: action ? { action, ...(draftContent ? { draftContent } : {}) } : null,
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

  it('does NOT trigger for unrelated messages when no announcement exists', async () => {
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

  it('ignores announcement that is more than 5 messages back', async () => {
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

describe('checkRecentActions with SMS-sent announcements (action: announcement)', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('recognizes follow-ups to announcements sent via SMS (action: "announcement")', async () => {
    const recentMessages = [
      makeMessage('outbound', 'happy friday\n- rsvp for alumni reunions is open\n- links to rsvp: https://luma.com/abc', 'announcement', 5),
      makeMessage('inbound', 'what dat mean', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what dat mean',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('alumni reunions')
  })

  it('handles informal follow-up "what dat mean" about multi-item announcement', async () => {
    const weeklyAnnouncement = "here's what's going on this week\n- janak is buying laptop file systems for $1K each and looking for non-developers interested. all PII is anonymized.\n- there's a $250 referral bonus for anyone who refers someone interested."
    const recentMessages = [
      makeMessage('outbound', weeklyAnnouncement, 'announcement', 5),
      makeMessage('inbound', 'what dat mean', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what dat mean',
      userName: 'Test User',
      recentMessages,
    })

    // Should reference the announcement content, not random facts
    expect(result.response).toContain('janak')
  })

  it('handles conversational correction "no about janak\'s thing"', async () => {
    const weeklyAnnouncement = "here's what's going on this week\n- janak is buying laptop file systems for $1K each\n- there's a $250 referral bonus"
    const recentMessages = [
      makeMessage('outbound', weeklyAnnouncement, 'announcement', 10),
      makeMessage('inbound', 'what dat mean', undefined, 5),
      makeMessage('outbound', 'sounds like you\'re asking about the venue address.', 'content_query', 4),
      makeMessage('inbound', "no about janak's thing", undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: "no about janak's thing",
      userName: 'Test User',
      recentMessages,
    })

    // Should find the announcement and reference janak's content
    expect(result.response).toContain('janak')
  })

  it('handles "send me the reunion rsvp links" when links are in announcement', async () => {
    const recentMessages = [
      makeMessage('outbound', 'happy friday\n- rsvp for alumni reunions is open\n- links to rsvp: new york - https://luma.com/dxrht7tj, los angeles - https://luma.com/uswl36v8, san francisco - https://luma.com/vo4dfr0l', 'announcement', 30),
      makeMessage('inbound', 'send me the reunion rsvp links', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'send me the reunion rsvp links',
      userName: 'Test User',
      recentMessages,
    })

    // Should find the announcement and include the links
    expect(result.response).toContain('reunion')
    expect(result.response).toContain('luma.com')
  })

  it('handles draft_send with draftContent in meta', async () => {
    const recentMessages = [
      makeMessage('outbound', 'sent to 15 people!', 'draft_send', 5, 'Team offsite moved to March 15. New location TBD.'),
      makeMessage('inbound', 'what did I just send', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'what did I just send',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).toContain('Team offsite')
    expect(result.response).toContain('March 15')
  })
})

describe('checkRecentActions does NOT false-positive', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('does NOT treat standalone questions as follow-ups to old chat messages', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ categories: ['facts'], reasoning: 'general question' }) } }],
    })

    const recentMessages = [
      makeMessage('outbound', 'hey whats up!', 'chat', 10),
      makeMessage('inbound', 'when is the next meeting', undefined, 0),
    ]

    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'when is the next meeting',
      userName: 'Test User',
      recentMessages,
    })

    // Should NOT contain chat content as "announcement"
    expect(result.response).not.toContain('hey whats up')
  })

  it('does NOT match follow-up when user words are all stop words', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ categories: ['upcoming'], reasoning: 'event query' }) } }],
    })

    const recentMessages = [
      makeMessage('outbound', 'Pizza party this Friday at 5pm!', 'announcement', 30),
      makeMessage('inbound', 'ok thanks', undefined, 25),
      makeMessage('outbound', 'np!', 'chat', 24),
      makeMessage('inbound', 'when is the next meeting', undefined, 0),
    ]

    // "when is the next meeting" has no words matching "Pizza party this Friday at 5pm!"
    // and is not a short confused reply, so should NOT be treated as follow-up
    const result = await handleContentQuery({
      phone: '+1234567890',
      message: 'when is the next meeting',
      userName: 'Test User',
      recentMessages,
    })

    expect(result.response).not.toContain('Pizza party')
  })
})
