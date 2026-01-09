import { Prisma } from '@prisma/client'
import { getPrisma } from '@/lib/prisma'
import { embedText } from './embeddings'
import type { ContentResult } from '@/lib/planner/actions/content'

const FALLBACK_KEYWORDS = ['the', 'and', 'for', 'are', 'what', 'when', 'where', 'how', 'who', 'why', 'can', 'does', 'will', 'about', 'with']

export async function searchFacts(query: string, limit = 5): Promise<ContentResult[]> {
  const prisma = await getPrisma()
  let results: ContentResult[] = []

  try {
    const embedding = await embedText(query)
    if (embedding.length > 0) {
      results = await searchByVector(prisma, embedding, limit)
    }
  } catch (error) {
    console.error('Semantic search error:', error)
  }

  if (results.length === 0) {
    results = await searchByKeywords(prisma, query, limit)
  }

  return results
}

async function searchByVector(prisma: Awaited<ReturnType<typeof getPrisma>>, embedding: number[], limit: number): Promise<ContentResult[]> {
  // Format embedding array for PostgreSQL pgvector
  // pgvector expects the format: '[1,2,3]'::vector
  const vectorArray = `'[${embedding.join(',')}]'::vector`
  
  // Ensure limit is a safe integer
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))

  // Use $queryRawUnsafe with properly formatted vector literal
  // The vector needs to be quoted as a string and cast to vector type
  const rows = await prisma.$queryRawUnsafe<
    Array<{ content: string; subcategory: string | null; category: string; timeRef: string | null; dateStr: string | null; score: number }>
  >(`
    SELECT content, subcategory, category, "timeRef", "dateStr",
      1 - (embedding <=> ${vectorArray}) AS score
    FROM "Fact"
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorArray}
    LIMIT ${safeLimit}
  `)

  return rows.map((row) => ({
    title: row.subcategory || row.category,
    body: buildBody(row.content, row.timeRef, row.subcategory, row.dateStr),
    score: row.score ?? 0,
    dateStr: row.dateStr || null,
    timeRef: row.timeRef || null
  }))
}

async function searchByKeywords(prisma: Awaited<ReturnType<typeof getPrisma>>, query: string, limit: number): Promise<ContentResult[]> {
  const keywords = query
    .toLowerCase()
    .replace(/[?!.,]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FALLBACK_KEYWORDS.includes(w))

  if (keywords.length === 0) return []

  const facts = await prisma.fact.findMany({
    where: {
      OR: [
        ...keywords.map((kw) => ({ content: { contains: kw, mode: 'insensitive' as const } })),
        ...keywords.map((kw) => ({ sourceText: { contains: kw, mode: 'insensitive' as const } })),
        ...keywords.map((kw) => ({ subcategory: { contains: kw, mode: 'insensitive' as const } })),
        ...keywords.map((kw) => ({ entities: { contains: kw, mode: 'insensitive' as const } })),
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  })

  return facts.map((fact) => ({
    title: fact.subcategory || fact.category,
    body: buildBody(fact.content, fact.timeRef, fact.subcategory || undefined, fact.dateStr || undefined),
    score: 0,
    dateStr: fact.dateStr || null,
    timeRef: fact.timeRef || null
  }))
}

function buildBody(content: string, timeRef: string | null, subcategory?: string | null, dateStr?: string | null): string {
  let body = `📋 ${content}`
  if (timeRef) body += `\n⏰ ${timeRef}`
  if (dateStr) body += `\n📅 ${dateStr}`
  if (subcategory) body += `\n📁 ${subcategory}`
  return body
}










