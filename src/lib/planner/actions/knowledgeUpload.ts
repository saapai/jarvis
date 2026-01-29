/**
 * Knowledge Upload Handler
 * Allows admins to text information to add to the knowledge base
 */

import { ActionResult } from '../types'
import { applyPersonality } from '../personality'
import { processUpload, llmClient, textExplorerRepository } from '@/text-explorer'

export interface KnowledgeUploadInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
  // Optional: space to associate this knowledge with (for multi-space users)
  spaceId?: string | null
}

/**
 * Use LLM to extract structured information from SMS text
 */
async function extractKnowledgeFromSMS(message: string, userName: string | null): Promise<{
  shouldUpload: boolean
  title: string
  reasoning: string
}> {
  if (!process.env.OPENAI_API_KEY) {
    return { shouldUpload: false, title: '', reasoning: 'No API key' }
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const systemPrompt = `You are analyzing SMS messages to determine if they contain information that should be added to an organization's knowledge base.

Information that SHOULD be uploaded:
- Event announcements with dates/times/locations
- Meeting schedules
- Important dates and deadlines
- Policy updates
- Contact information
- Resources and links
- Procedural information

Information that should NOT be uploaded:
- Commands to the bot
- Questions
- Casual conversation
- Complaints
- Personal messages

If the message contains knowledge worth uploading, suggest a brief title (5-8 words) for the upload.

Respond with JSON: { "shouldUpload": boolean, "title": string, "reasoning": string }`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Should this be added to the knowledge base? "${message}"` }
      ],
      temperature: 0.2,
      max_tokens: 150,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      console.log(`[KnowledgeUpload] shouldUpload=${parsed.shouldUpload}, title=${parsed.title}`)
      return {
        shouldUpload: parsed.shouldUpload || false,
        title: parsed.title || 'SMS Upload',
        reasoning: parsed.reasoning || 'LLM analysis'
      }
    }
  } catch (error) {
    console.error('[KnowledgeUpload] LLM analysis failed:', error)
  }

  return { shouldUpload: false, title: '', reasoning: 'Fallback' }
}

/**
 * Handle knowledge upload action (admin only)
 */
export async function handleKnowledgeUpload(input: KnowledgeUploadInput): Promise<ActionResult> {
  const { phone, message, userName, isAdmin, spaceId } = input

  // Only admins can upload knowledge
  if (!isAdmin) {
    return {
      action: 'chat',
      response: applyPersonality({
        baseResponse: "only admins can add info to the knowledge base",
        userMessage: message,
        userName
      })
    }
  }

  console.log(`[KnowledgeUpload] Admin ${userName} attempting to upload knowledge`)

  // Use LLM to determine if this should be uploaded
  const analysis = await extractKnowledgeFromSMS(message, userName)

  if (!analysis.shouldUpload) {
    console.log(`[KnowledgeUpload] Message doesn't contain uploadable knowledge: ${analysis.reasoning}`)
    return {
      action: 'chat',
      response: applyPersonality({
        baseResponse: "that doesn't look like info to add to the knowledge base. try something like 'ski retreat is happening jan 16-19 in utah'",
        userMessage: message,
        userName
      })
    }
  }

  try {
    // Create upload record
    const uploadName = analysis.title || `SMS from ${userName || 'Admin'} - ${new Date().toISOString()}`
    const { id: uploadId } = await textExplorerRepository.createUpload({
      name: uploadName,
      rawText: message,
      spaceId: spaceId || undefined
    })

    console.log(`[KnowledgeUpload] Created upload ${uploadId}`)

    // Process and extract facts using LLM
    const processResult = await processUpload(message, llmClient)

    console.log(`[KnowledgeUpload] Extracted ${processResult.facts.length} facts`)

    // Save facts to database
    await textExplorerRepository.createFacts({
      uploadId,
      facts: processResult.facts,
      spaceId: spaceId || undefined
    })

    const factSummary = processResult.facts.length > 0
      ? `extracted ${processResult.facts.length} fact${processResult.facts.length > 1 ? 's' : ''}`
      : 'processed'

    return {
      action: 'knowledge_upload',
      response: applyPersonality({
        baseResponse: `✅ added to knowledge base: "${uploadName}". ${factSummary}`,
        userMessage: message,
        userName
      })
    }
  } catch (error) {
    console.error('[KnowledgeUpload] Upload failed:', error)
    return {
      action: 'knowledge_upload',
      response: applyPersonality({
        baseResponse: `failed to upload. error: ${error instanceof Error ? error.message : 'unknown'}`,
        userMessage: message,
        userName
      })
    }
  }
}

