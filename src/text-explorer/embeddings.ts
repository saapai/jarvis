import { getOpenAI } from '@/lib/openai'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const MAX_INPUT_CHARS = 8000

export async function embedText(text: string): Promise<number[]> {
  const openai = getOpenAI()
  const trimmed = text.slice(0, MAX_INPUT_CHARS)

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: trimmed
  })

  return response.data[0]?.embedding || []
}


