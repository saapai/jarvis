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
  const vectorLiteral = `[${embedding.join(',')}]`
  
  // Ensure limit is a safe integer
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))

  // Use Prisma.sql with Prisma.raw for the vector literal
  // The vector literal format [1,2,3] needs to be passed as raw SQL
  const rows = await prisma.$queryRaw<
    Array<{ content: string; subcategory: string | null; category: string; timeRef: string | null; dateStr: string | null; score: number }>
  >(Prisma.sql`
    SELECT content, subcategory, category, "timeRef", "dateStr",
      1 - (embedding <=> ${Prisma.raw(vectorLiteral)}::vector) AS score
    FROM "Fact"
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${Prisma.raw(vectorLiteral)}::vector
    LIMIT ${safeLimit}
  `)

  return rows.map((row) => ({
    title: row.subcategory || row.category,
    body: buildBody(row.content, row.timeRef, row.subcategory),
    score: row.score ?? 0
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
    body: buildBody(fact.content, fact.timeRef, fact.subcategory || undefined),
    score: 0
  }))
}

function buildBody(content: string, timeRef: string | null, subcategory?: string | null): string {
  let body = `📋 ${content}`
  if (timeRef) body += `\n⏰ ${timeRef}`
  if (subcategory) body += `\n📁 ${subcategory}`
  return body
}










