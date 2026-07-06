import { getOpenAI } from '@/lib/openai'

export const VECTOR_DIMENSION = 1536
const EMBEDDING_MODEL = 'text-embedding-3-small'
const MAX_INPUT_CHARS = 8000

const zeroVector = () => Array.from({ length: VECTOR_DIMENSION }, () => 0)

export async function embedText(text: string): Promise<number[]> {
  const openai = getOpenAI()
  const trimmed = text.slice(0, MAX_INPUT_CHARS)

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: trimmed
    })

    const embedding = response.data[0]?.embedding
    if (Array.isArray(embedding) && embedding.length === VECTOR_DIMENSION) {
      return embedding
    }
    console.error('Embedding generation returned unexpected shape', {
      length: Array.isArray(embedding) ? embedding.length : null
    })
    return []
  } catch (error) {
    console.error('Embedding generation failed:', error)
    // Return empty so callers store NULL instead of a zero vector —
    // a stored zero vector passes the dimension check and produces NaN
    // cosine distances in pgvector queries.
    return []
  }
}

export const emptyVector = zeroVector












