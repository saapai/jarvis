import { Prisma } from '@prisma/client'
import { getPrisma } from '@/lib/prisma'
import { embedText } from './embeddings'
import type { ContentResult } from '@/lib/planner/actions/content'

// entities/calendarDates are stored as JSON strings. Parse leniently — a bad row
// should degrade to "no extras", never throw and kill the whole search.
function parseJsonArray(raw: string | null | undefined): string[] | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : null
  } catch {
    return null
  }
}

// details is a JSON array of objects {label,date?,url?,location?,note?}
function parseDetails(raw: string | null | undefined): ContentResult['details'] {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    if (!Array.isArray(v)) return null
    return v.filter((d) => d && typeof d.label === 'string')
  } catch {
    return null
  }
}

const FALLBACK_KEYWORDS = ['the', 'and', 'for', 'are', 'what', 'when', 'where', 'how', 'who', 'why', 'can', 'does', 'will', 'about', 'with']

// Below this cosine similarity a vector match is noise — rely on keyword results instead.
// text-embedding-3-small produces low absolute cosine scores: a genuinely relevant
// match often lands around 0.2-0.3, so anything much higher discards real hits.
const MIN_SIMILARITY = 0.12

export async function searchFacts(query: string, limit = 10, spaceId?: string | null): Promise<ContentResult[]> {
  const prisma = await getPrisma()
  let results: ContentResult[] = []

  try {
    const embedding = await embedText(query)
    if (embedding.length > 0) {
      results = await searchByVector(prisma, embedding, limit * 2, spaceId) // Get more results from vector search
    }
  } catch (error) {
    console.error('Semantic search error:', error)
  }

  // Always also do keyword search to catch things vector search might miss (like recurring events)
  const keywordResults = await searchByKeywords(prisma, query, limit * 2, spaceId)
  
  // Merge results, prioritizing vector results but including keyword results
  const resultMap = new Map<string, ContentResult>()
  
  // Add vector results first (they have scores)
  results.forEach(r => {
    const key = `${r.title || ''}_${r.dateStr || ''}`
    if (!resultMap.has(key) || (resultMap.get(key)?.score || 0) < r.score) {
      resultMap.set(key, r)
    }
  })
  
  // Add keyword results (they might catch things vector search missed). Keep the
  // HIGHER score when a fact showed up in both — a strong exact-title keyword hit
  // must not be masked by the same fact's weak vector score.
  keywordResults.forEach(r => {
    const key = `${r.title || ''}_${r.dateStr || ''}`
    const existing = resultMap.get(key)
    if (!existing || (existing.score || 0) < r.score) {
      resultMap.set(key, r)
    }
  })
  
  // Sort by score (vector results) and take top results
  const merged = Array.from(resultMap.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit)

  return merged.length > 0 ? merged : keywordResults.slice(0, limit)
}

async function searchByVector(prisma: Awaited<ReturnType<typeof getPrisma>>, embedding: number[], limit: number, spaceId?: string | null): Promise<ContentResult[]> {
  // Format embedding array for PostgreSQL pgvector
  // pgvector expects the format: '[1,2,3]'::vector
  const vectorArray = `'[${embedding.join(',')}]'::vector`

  // Ensure limit is a safe integer
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))

  // Facts without embeddings are covered by keyword search; only rank real vectors here.
  // spaceId NULL rows are legacy/global facts visible to every space.
  const spaceFilter = spaceId
    ? `AND ("spaceId" = $1 OR "spaceId" IS NULL)`
    : ''

  const sql = `
    SELECT content, subcategory, category, "timeRef", "dateStr", "sourceText", entities, "calendarDates", details, "createdAt",
      1 - (embedding <=> ${vectorArray}) AS score
    FROM "Fact"
    WHERE embedding IS NOT NULL
    ${spaceFilter}
    ORDER BY embedding <=> ${vectorArray}, "createdAt" DESC
    LIMIT ${safeLimit}
  `

  type Row = { content: string; subcategory: string | null; category: string; timeRef: string | null; dateStr: string | null; sourceText: string | null; entities: string | null; calendarDates: string | null; details: string | null; createdAt: Date | null; score: number }
  const rows = await (spaceId
    ? prisma.$queryRawUnsafe<Row[]>(sql, spaceId)
    : prisma.$queryRawUnsafe<Row[]>(sql))

  return rows
    .filter((row) => Number.isFinite(row.score) && row.score >= MIN_SIMILARITY)
    .map((row) => ({
      title: row.subcategory || row.category,
      body: buildBody(row.content, row.timeRef, row.subcategory, row.dateStr),
      score: row.score ?? 0,
      dateStr: row.dateStr || null,
      timeRef: row.timeRef || null,
      sourceText: row.sourceText || null,
      entities: parseJsonArray(row.entities),
      calendarDates: parseJsonArray(row.calendarDates),
      details: parseDetails(row.details),
      createdAt: row.createdAt || null
    }))
}

async function searchByKeywords(prisma: Awaited<ReturnType<typeof getPrisma>>, query: string, limit: number, spaceId?: string | null): Promise<ContentResult[]> {
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
      // spaceId NULL rows are legacy/global facts visible to every space
      ...(spaceId ? { OR: [{ spaceId }, { spaceId: null }] } : {}),
      AND: {
        OR: [
          ...expandedKeywords.map((kw) => ({ content: { contains: kw, mode: 'insensitive' as const } })),
          ...expandedKeywords.map((kw) => ({ sourceText: { contains: kw, mode: 'insensitive' as const } })),
          ...expandedKeywords.map((kw) => ({ subcategory: { contains: kw, mode: 'insensitive' as const } })),
          ...expandedKeywords.map((kw) => ({ entities: { contains: kw, mode: 'insensitive' as const } })),
          // Also search in timeRef for recurring events
          ...expandedKeywords.map((kw) => ({ timeRef: { contains: kw, mode: 'insensitive' as const } })),
        ]
      }
    },
    // Rank in JS below — the pool must be big enough to hold EVERY keyword match.
    // (This used to take limit*2 ordered by subcategory DESC — i.e. alphabetically
    // backwards — so "Active Meetings" (A) was truncated out of the pool before
    // scoring while "Weekly Meeting" (W) sailed in. Candidate selection must never
    // be the ranking.)
    orderBy: { createdAt: 'desc' },
    take: 200
  })

  const queryLower = query.toLowerCase()
  // Per-keyword matcher with a singular fallback ("reunions" also matches "reunion")
  const matches = (text: string, kw: string) =>
    text.includes(kw) || (kw.endsWith('s') && text.includes(kw.slice(0, -1)))

  // Rank by HOW MANY query keywords hit, weighted by where they hit. Boolean any-match
  // scoring made "Weekly Meeting" (1 keyword: "meeting") tie "Active Meetings"
  // (2 keywords: "active"+"meeting") for "when is active meeting".
  const ranked = facts.map((fact) => {
    const subcategoryLower = (fact.subcategory || '').toLowerCase()
    const contentLower = (fact.content || '').toLowerCase()
    const sourceTextLower = (fact.sourceText || '').toLowerCase()
    const timeRefLower = (fact.timeRef || '').toLowerCase()
    const entitiesLower = (fact.entities || '').toLowerCase()

    let score = 0
    const subHits = keywords.filter(kw => matches(subcategoryLower, kw)).length
    score += subHits * 5
    if (keywords.length > 1 && subHits === keywords.length) score += 6 // title covers the whole query
    if (subcategoryLower && (subcategoryLower.includes(queryLower) || queryLower.includes(subcategoryLower))) {
      score += 10 // exact phrase either direction
    }
    score += keywords.filter(kw => matches(contentLower, kw) || matches(sourceTextLower, kw)).length * 2
    if (keywords.some(kw => matches(timeRefLower, kw))) score += 2
    if (keywords.some(kw => matches(entitiesLower, kw))) score += 2

    return { fact, score }
  }).sort((a, b) => b.score - a.score).slice(0, limit)

  // Normalize the internal relevance into a real similarity-scale score so keyword
  // hits COMPETE with vector matches in the merge instead of always losing (this used
  // to return score:0, burying exact title matches under vector noise). A full-title
  // match lands ~0.9+; a stray single-keyword content match stays near the vector
  // noise floor so it can't outrank a genuine semantic hit.
  return ranked.map(({ fact, score }) => ({
    title: fact.subcategory || fact.category,
    body: buildBody(fact.content, fact.timeRef, fact.subcategory || undefined, fact.dateStr || undefined),
    score: Math.min(0.95, 0.12 + score * 0.04),
    dateStr: fact.dateStr || null,
    timeRef: fact.timeRef || null,
    sourceText: fact.sourceText || null,
    entities: parseJsonArray(fact.entities),
    calendarDates: parseJsonArray(fact.calendarDates),
    details: parseDetails((fact as { details?: string | null }).details),
    createdAt: fact.createdAt || null
  }))
}

function buildBody(content: string, timeRef: string | null, subcategory?: string | null, dateStr?: string | null): string {
  let body = `📋 ${content}`
  if (timeRef) body += `\n⏰ ${timeRef}`
  if (dateStr) body += `\n📅 ${dateStr}`
  if (subcategory) body += `\n📁 ${subcategory}`
  return body
}










