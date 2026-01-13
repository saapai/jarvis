import { Prisma } from '@prisma/client'
import { getPrisma } from '@/lib/prisma'
import { embedText } from './embeddings'
import type { ContentResult } from '@/lib/planner/actions/content'

const FALLBACK_KEYWORDS = ['the', 'and', 'for', 'are', 'what', 'when', 'where', 'how', 'who', 'why', 'can', 'does', 'will', 'about', 'with']

export async function searchFacts(query: string, limit = 10): Promise<ContentResult[]> {
  const prisma = await getPrisma()
  let results: ContentResult[] = []

  try {
    const embedding = await embedText(query)
    if (embedding.length > 0) {
      results = await searchByVector(prisma, embedding, limit * 2) // Get more results from vector search
    }
  } catch (error) {
    console.error('Semantic search error:', error)
  }

  // Always also do keyword search to catch things vector search might miss (like recurring events)
  const keywordResults = await searchByKeywords(prisma, query, limit * 2)
  
  // Merge results, prioritizing vector results but including keyword results
  const resultMap = new Map<string, ContentResult>()
  
  // Add vector results first (they have scores)
  results.forEach(r => {
    const key = `${r.title || ''}_${r.dateStr || ''}`
    if (!resultMap.has(key) || (resultMap.get(key)?.score || 0) < r.score) {
      resultMap.set(key, r)
    }
  })
  
  // Add keyword results (they might catch things vector search missed)
  keywordResults.forEach(r => {
    const key = `${r.title || ''}_${r.dateStr || ''}`
    if (!resultMap.has(key)) {
      resultMap.set(key, r)
    }
  })
  
  // Sort by score (vector results) and take top results
  const merged = Array.from(resultMap.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit)

  return merged.length > 0 ? merged : keywordResults.slice(0, limit)
}

async function searchByVector(prisma: Awaited<ReturnType<typeof getPrisma>>, embedding: number[], limit: number): Promise<ContentResult[]> {
  // Format embedding array for PostgreSQL pgvector
  // pgvector expects the format: '[1,2,3]'::vector
  const vectorArray = `'[${embedding.join(',')}]'::vector`
  
  // Ensure limit is a safe integer
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))

  // Use $queryRawUnsafe with properly formatted vector literal
  // The vector needs to be quoted as a string and cast to vector type
  // Include ALL facts, prioritizing those with embeddings but also including recurring events
  // Include sourceText to preserve URLs/links
  const rows = await prisma.$queryRawUnsafe<
    Array<{ content: string; subcategory: string | null; category: string; timeRef: string | null; dateStr: string | null; sourceText: string | null; score: number }>
  >(`
    SELECT content, subcategory, category, "timeRef", "dateStr", "sourceText",
      CASE 
        WHEN embedding IS NOT NULL THEN 1 - (embedding <=> ${vectorArray})
        ELSE 0.5
      END AS score
    FROM "Fact"
    ORDER BY 
      CASE 
        WHEN embedding IS NOT NULL THEN embedding <=> ${vectorArray}
        ELSE 999999
      END,
      "createdAt" DESC
    LIMIT ${safeLimit}
  `)

  return rows.map((row) => ({
    title: row.subcategory || row.category,
    body: buildBody(row.content, row.timeRef, row.subcategory, row.dateStr),
    score: row.score ?? 0,
    dateStr: row.dateStr || null,
    timeRef: row.timeRef || null,
    sourceText: row.sourceText || null
  }))
}

async function searchByKeywords(prisma: Awaited<ReturnType<typeof getPrisma>>, query: string, limit: number): Promise<ContentResult[]> {
  const keywords = query
    .toLowerCase()
    .replace(/[?!.,]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FALLBACK_KEYWORDS.includes(w))

  if (keywords.length === 0) return []

  // Also try searching with singular/plural variations and partial matches
  const expandedKeywords: string[] = []
  for (const kw of keywords) {
    expandedKeywords.push(kw)
    // Add singular/plural variations
    if (kw.endsWith('s')) {
      expandedKeywords.push(kw.slice(0, -1)) // Remove 's'
    } else {
      expandedKeywords.push(kw + 's') // Add 's'
    }
    // Add partial matches (for "active meetings" -> "meeting")
    if (kw.includes('meeting')) {
      expandedKeywords.push('meeting')
    }
    if (kw.includes('meetings')) {
      expandedKeywords.push('meeting', 'meetings')
    }
  }

  const facts = await prisma.fact.findMany({
    where: {
      OR: [
        ...expandedKeywords.map((kw) => ({ content: { contains: kw, mode: 'insensitive' as const } })),
        ...expandedKeywords.map((kw) => ({ sourceText: { contains: kw, mode: 'insensitive' as const } })),
        ...expandedKeywords.map((kw) => ({ subcategory: { contains: kw, mode: 'insensitive' as const } })),
        ...expandedKeywords.map((kw) => ({ entities: { contains: kw, mode: 'insensitive' as const } })),
        // Also search in timeRef for recurring events
        ...expandedKeywords.map((kw) => ({ timeRef: { contains: kw, mode: 'insensitive' as const } })),
      ]
    },
    orderBy: [
      // Prioritize exact matches in subcategory
      { subcategory: 'desc' },
      { createdAt: 'desc' }
    ],
    take: limit * 2 // Get more results to allow for better ranking
  })

  // Rank results: exact subcategory matches first, then content matches
  const ranked = facts.map((fact) => {
    const subcategoryLower = (fact.subcategory || '').toLowerCase()
    const contentLower = (fact.content || '').toLowerCase()
    const sourceTextLower = (fact.sourceText || '').toLowerCase()
    const timeRefLower = (fact.timeRef || '').toLowerCase()
    
    let score = 0
    const queryLower = query.toLowerCase()
    
    // Exact subcategory match gets highest score
    if (subcategoryLower.includes(queryLower) || queryLower.includes(subcategoryLower)) {
      score += 10
    }
    // Subcategory contains keywords
    if (keywords.some(kw => subcategoryLower.includes(kw))) {
      score += 5
    }
    // Content contains keywords
    if (keywords.some(kw => contentLower.includes(kw) || sourceTextLower.includes(kw))) {
      score += 3
    }
    // TimeRef match (important for recurring events)
    if (keywords.some(kw => timeRefLower.includes(kw))) {
      score += 2
    }
    
    return { fact, score }
  }).sort((a, b) => b.score - a.score).slice(0, limit)

  return ranked.map(({ fact }) => ({
    title: fact.subcategory || fact.category,
    body: buildBody(fact.content, fact.timeRef, fact.subcategory || undefined, fact.dateStr || undefined),
    score: 0,
    dateStr: fact.dateStr || null,
    timeRef: fact.timeRef || null,
    sourceText: fact.sourceText || null
  }))
}

function buildBody(content: string, timeRef: string | null, subcategory?: string | null, dateStr?: string | null): string {
  let body = `📋 ${content}`
  if (timeRef) body += `\n⏰ ${timeRef}`
  if (dateStr) body += `\n📅 ${dateStr}`
  if (subcategory) body += `\n📁 ${subcategory}`
  return body
}










