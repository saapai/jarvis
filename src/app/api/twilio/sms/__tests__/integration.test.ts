/**
 * Integration test for SMS Pipeline
 * Tests the full flow: webhook → classification → handler → response
 */

import { classifyIntent } from '@/lib/planner/classifier'
import { buildWeightedHistoryFromMessages } from '@/lib/planner/history'
import type { ClassificationContext, WeightedTurn } from '@/lib/planner/types'

describe('SMS Pipeline Integration', () => {
  describe('Intent Classification', () => {
    it('should classify announcement creation', async () => {
      const context: ClassificationContext = {
        currentMessage: 'announce meeting tonight at 7pm',
        history: [],
        activeDraft: null,
        isAdmin: true,
        userName: 'Admin'
      }
      
      const result = await classifyIntent(context)
      
      expect(result.action).toBe('draft_write')
      expect(result.subtype).toBe('announcement')
      expect(result.confidence).toBeGreaterThan(0.8)
    })
    
    it('should classify poll creation', async () => {
      const context: ClassificationContext = {
        currentMessage: "who's coming to active tonight?",
        history: [],
        activeDraft: null,
        isAdmin: true,
        userName: 'Admin'
      }
      
      const result = await classifyIntent(context)
      
      expect(result.action).toBe('draft_write')
      expect(result.subtype).toBe('poll')
      expect(result.confidence).toBeGreaterThan(0.8)
    })
    
    it('should classify send command with active draft', async () => {
      const context: ClassificationContext = {
        currentMessage: 'send',
        history: [],
        activeDraft: {
          type: 'announcement',
          content: 'Meeting tonight at 7pm',
          status: 'ready',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        isAdmin: true,
        userName: 'Admin'
      }
      
      const result = await classifyIntent(context)
      
      expect(result.action).toBe('draft_send')
      expect(result.confidence).toBeGreaterThan(0.9)
    })
    
    it('should classify knowledge query', async () => {
      const context: ClassificationContext = {
        currentMessage: 'when is study hall?',
        history: [],
        activeDraft: null,
        isAdmin: false,
        userName: 'User'
      }
      
      const result = await classifyIntent(context)
      
      expect(result.action).toBe('content_query')
      expect(result.confidence).toBeGreaterThan(0.7)
    })
  })
  
  describe('Weighted History', () => {
    it('should apply decay weights to message history', () => {
      const messages = [
        { direction: 'inbound' as const, text: 'msg1', createdAt: new Date('2024-01-01T10:00:00Z'), meta: null },
        { direction: 'outbound' as const, text: 'msg2', createdAt: new Date('2024-01-01T10:01:00Z'), meta: null },
        { direction: 'inbound' as const, text: 'msg3', createdAt: new Date('2024-01-01T10:02:00Z'), meta: null },
        { direction: 'outbound' as const, text: 'msg4', createdAt: new Date('2024-01-01T10:03:00Z'), meta: null },
        { direction: 'inbound' as const, text: 'msg5', createdAt: new Date('2024-01-01T10:04:00Z'), meta: null },
      ]
      
      const weighted = buildWeightedHistoryFromMessages(messages)
      
      expect(weighted).toHaveLength(5)
      // Most recent message should have weight 1.0
      expect(weighted[4].weight).toBe(1.0)
      // Second most recent should have weight 0.8
      expect(weighted[3].weight).toBe(0.8)
      // Oldest should have weight 0.2
      expect(weighted[0].weight).toBe(0.2)
    })
  })
  
  describe('Follow-up Detection', () => {
    it('should detect edit as follow-up with draft context', async () => {
      const context: ClassificationContext = {
        currentMessage: 'actually make it 8pm',
        history: [
          { role: 'user', content: 'announce meeting tonight at 7pm', timestamp: Date.now() - 10000, weight: 0.8 },
          { role: 'assistant', content: 'here\'s the announcement: "Meeting tonight at 7pm"', timestamp: Date.now() - 5000, weight: 1.0 }
        ],
        activeDraft: {
          type: 'announcement',
          content: 'Meeting tonight at 7pm',
          status: 'ready',
          createdAt: Date.now() - 15000,
          updatedAt: Date.now() - 5000
        },
        isAdmin: true,
        userName: 'Admin'
      }
      
      const result = await classifyIntent(context)
      
      expect(result.action).toBe('draft_write')
      expect(result.confidence).toBeGreaterThan(0.7)
    })
  })
})

describe('Poll Response Parsing', () => {
  const { parsePollResponse } = require('@/lib/planner/pollResponseParser')
  
  it('should parse affirmative responses', () => {
    expect(parsePollResponse('yes')).toEqual({ response: 'Yes', notes: null })
    expect(parsePollResponse('yeah I\'ll be there')).toEqual({ response: 'Yes', notes: expect.any(String) })
    expect(parsePollResponse('coming but late')).toEqual({ response: 'Yes', notes: expect.stringContaining('late') })
  })
  
  it('should parse negative responses', () => {
    expect(parsePollResponse('no')).toEqual({ response: 'No', notes: null })
    expect(parsePollResponse('can\'t make it')).toEqual({ response: 'No', notes: expect.any(String) })
    expect(parsePollResponse('sorry, busy tonight')).toEqual({ response: 'No', notes: expect.stringContaining('busy') })
  })
  
  it('should parse uncertain responses', () => {
    expect(parsePollResponse('maybe')).toEqual({ response: 'Maybe', notes: null })
    expect(parsePollResponse('not sure yet')).toEqual({ response: 'Maybe', notes: expect.any(String) })
    expect(parsePollResponse('depends on work')).toEqual({ response: 'Maybe', notes: expect.stringContaining('work') })
  })
})

