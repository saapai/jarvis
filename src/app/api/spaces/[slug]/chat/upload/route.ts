import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth/supabase-server'
import { getOrCreateUser } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'
import { getSpaceId } from '@/lib/spaces'
import { extractTextFromUploadedFile } from '@/text-explorer/fileExtract'
import { processUpload, llmClient } from '@/text-explorer'
import { textExplorerRepository } from '@/text-explorer'

export const dynamic = 'force-dynamic'

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

    const formData = await req.formData()
    const fileField = formData.get('file')
    const nameField = formData.get('name')

    if (!fileField || typeof fileField === 'string') {
      return new Response('File is required', { status: 400 })
    }

    const file = fileField as File
    const fileName = (typeof nameField === 'string' ? nameField : file.name) || 'Upload'

    // Extract text from file
    let rawText: string
    try {
      rawText = await extractTextFromUploadedFile(file, fileName)
    } catch (error) {
      console.error('File extraction error:', error)
      return new Response('Failed to extract text from file', { status: 400 })
    }

    if (!rawText || rawText.trim().length === 0) {
      return new Response('No text content found in file', { status: 400 })
    }

    // Create upload record
    const { id: uploadId } = await textExplorerRepository.createUpload({
      name: fileName,
      rawText,
      spaceId
    })

    // Create streaming response
    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Send initial message
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `Processing "${fileName}"...\n\n` })}\n\n`))

          // Process upload with LLM
          const processResult = await processUpload(rawText, llmClient)

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `Found ${processResult.facts.length} facts. Saving to knowledge base...\n\n` })}\n\n`))

          // Save facts with spaceId
          await textExplorerRepository.createFacts({
            uploadId,
            facts: processResult.facts,
            spaceId
          })

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `✓ Successfully processed "${fileName}"!\n\nI've extracted ${processResult.facts.length} facts and added them to the knowledge base. You can now ask me questions about this content.\n\n` })}\n\n`))

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          console.error('Upload processing error:', error)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: 'Sorry, I encountered an error processing your file. Please try again.\n\n' })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
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
    console.error('Upload API error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
