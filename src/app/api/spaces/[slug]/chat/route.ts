import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth/supabase-server'
import { getOrCreateUser } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'
import { getSpaceId } from '@/lib/spaces'
import { processUpload, llmClient, textExplorerRepository } from '@/text-explorer'

export const dynamic = 'force-dynamic'
// Note: Removed 'edge' runtime to support OpenAI streaming

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const supabaseUser = await requireAuth()
    const user = await getOrCreateUser(supabaseUser)

    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const spaceId = await getSpaceId(slug)
    if (!spaceId) {
      return new Response('Space not found', { status: 404 })
    }

    // Check if user is a member
    const prisma = await getPrisma()
    const membership = await prisma.spaceMember.findFirst({
      where: {
        spaceId,
        userId: user.id
      }
    })

    if (!membership) {
      return new Response('Not a member of this space', { status: 403 })
    }

    const { message } = await req.json()

    if (!message || typeof message !== 'string') {
      return new Response('Message is required', { status: 400 })
    }

    if (!process.env.OPENAI_API_KEY) {
      return new Response('OpenAI API key not configured', { status: 500 })
    }

    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    // First, check if the message is informational (providing information) vs a question
    const classificationResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Classify the user message as either "information" (user is providing facts/information) or "question" (user is asking something). Respond with only one word: "information" or "question".'
        },
        { role: 'user', content: message }
      ],
      temperature: 0.3,
      max_tokens: 10
    })

    const classification = classificationResponse.choices[0]?.message?.content?.toLowerCase().trim()

    // If informational, extract facts and save them
    if (classification === 'information' || classification?.includes('information')) {
      try {
        // Process the message as if it were an upload
        const processResult = await processUpload(message, llmClient)

        if (processResult.facts.length > 0) {
          // Create a virtual upload record
          const { id: uploadId } = await textExplorerRepository.createUpload({
            name: `Chat message from ${user.name || 'user'}`,
            rawText: message,
            spaceId
          })

          // Save facts
          await textExplorerRepository.createFacts({
            uploadId,
            facts: processResult.facts,
            spaceId
          })
        }
      } catch (error) {
        console.error('Error processing informational message:', error)
        // Continue to respond even if fact extraction fails
      }
    }

    // Get facts from this space for context
    const facts = await prisma.fact.findMany({
      where: { spaceId },
      take: 50,
      orderBy: { createdAt: 'desc' },
      select: {
        content: true,
        subcategory: true,
        category: true,
        dateStr: true,
        timeRef: true,
        entities: true
      }
    })

    // Build context from facts
    const context = facts.map(f => {
      const entities = typeof f.entities === 'string' ? JSON.parse(f.entities) : f.entities
      return `- ${f.subcategory || f.category}: ${f.content}${f.dateStr ? ` (${f.dateStr})` : ''}${entities.length > 0 ? ` [${entities.join(', ')}]` : ''}`
    }).join('\n')

    const systemPrompt = `You are Jarvis, a helpful assistant for this space. You have access to the following information:

${context || 'No information available yet. You can help users upload documents to build the knowledge base.'}

Answer questions based on this information. Be concise, helpful, and friendly. If you don't know something, say so.${classification === 'information' || classification?.includes('information') ? ' The user just provided information - acknowledge that you\'ve saved it.' : ''}`

    // Create streaming response
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      stream: true,
      temperature: 0.7
    })

    // Create a readable stream
    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`))
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          console.error('Streaming error:', error)
          controller.error(error)
        }
      }
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
