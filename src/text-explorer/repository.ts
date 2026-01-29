import { getPrisma } from '@/lib/prisma';
import { TextExplorerRepository, ExtractedFact } from './types';
import { VECTOR_DIMENSION, embedText } from './embeddings';
import { openai } from '@/lib/openai';

// ---- Time helpers for card-oriented identity ----

function extractWeekNumber(
  dateStr?: string | null,
  timeRef?: string | null
): number | null {
  const combined = `${dateStr ?? ''} ${timeRef ?? ''}`.toLowerCase();
  const weekMatch = combined.match(/\bweek\s*:?\s*(\d+)\b/);
  if (!weekMatch) return null;
  const parsed = parseInt(weekMatch[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeIsoDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function hasTemporalIdentity(
  week: number | null,
  isoDate: string | null
): boolean {
  return week !== null || isoDate !== null;
}

function isSameCardTime(
  baseWeek: number | null,
  baseDate: string | null,
  otherWeek: number | null,
  otherDate: string | null
): boolean {
  if (!hasTemporalIdentity(baseWeek, baseDate) || !hasTemporalIdentity(otherWeek, otherDate)) {
    // If either side has no temporal identifier, don't treat as the same card
    return false;
  }

  const weeksEqual =
    baseWeek !== null && otherWeek !== null && baseWeek === otherWeek;
  const datesEqual =
    baseDate !== null && otherDate !== null && baseDate === otherDate;

  // Same title + same week:
  // - If both have dates, they must match
  // - If either is missing a date, still treat as the same card
  if (weeksEqual) {
    if (!baseDate || !otherDate || datesEqual) {
      return true;
    }
  }

  // Same title + same date:
  // - If both have weeks, they must match
  // - If either is missing a week, still treat as the same card
  if (datesEqual) {
    if (baseWeek === null || otherWeek === null || weeksEqual) {
      return true;
    }
  }

  return false;
}

/**
 * Parse calendar dates from fact content/timeRef/dateStr using LLM.
 * Returns array of YYYY-MM-DD dates for calendar display.
 */
async function parseCalendarDates(fact: {
  subcategory?: string | null;
  timeRef?: string | null;
  content?: string;
  dateStr?: string | null;
}): Promise<string[]> {
  if (!fact.timeRef && !fact.content && !fact.dateStr) return [];
  
  try {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();
    
    // Sanitize inputs to prevent issues
    const sanitize = (str: string | null | undefined): string => {
      if (!str) return '';
      return str.substring(0, 500).replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters
    };
    
    const prompt = `Extract ALL dates for this event and return them as an array of YYYY-MM-DD dates.

CRITICAL: If the event spans multiple days, return ALL dates in the range, not just the start and end dates.

Examples of date ranges:
- "January 16 to January 19" -> ["2026-01-16", "2026-01-17", "2026-01-18", "2026-01-19"]
- "jan 16-19" -> ["2026-01-16", "2026-01-17", "2026-01-18", "2026-01-19"]
- "jan 24-25" -> ["2026-01-24", "2026-01-25"]
- "January 16 to January 29" -> ["2026-01-16", "2026-01-17", ..., "2026-01-29"] (all dates)
- "jan 16 to jan 29" -> ["2026-01-16", "2026-01-17", ..., "2026-01-29"] (all dates)

Single dates:
- "January 10" -> ["2026-01-10"]
- "jan 24" -> ["2026-01-24"]

Recurring events (return empty array):
- "every Wednesday" -> []
- "recurring:wednesday" -> []

Today's date: ${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}

Fact information:
- subcategory: "${sanitize(fact.subcategory)}"
- timeRef: "${sanitize(fact.timeRef)}"
- content: "${sanitize(fact.content)}"
- dateStr: "${sanitize(fact.dateStr)}"

Return JSON: { "dates": ["YYYY-MM-DD", ...] }`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise date parser. Extract ALL dates from date ranges, including every day between start and end dates. Return dates in YYYY-MM-DD format. Return ONLY valid JSON.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 500
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      try {
      const parsed = JSON.parse(content);
        const dates = parsed.dates || [];
        // Validate dates are in YYYY-MM-DD format
        return dates.filter((d: any) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
      } catch (parseError) {
        console.error('[TextExplorer] JSON parse error in calendar dates:', parseError, 'Content:', content?.substring(0, 200));
        return [];
      }
    }
  } catch (error) {
    console.error('[TextExplorer] Calendar date parsing failed:', error);
  }
  
  return [];
}

export const textExplorerRepository: TextExplorerRepository = {
  async createUpload({ name, rawText, spaceId }) {
    const prisma = await getPrisma();
    const upload = await prisma.upload.create({
      data: { name, rawText, spaceId },
      select: { id: true },
    });
    return { id: upload.id };
  },

  async createFacts({ uploadId, facts, spaceId }) {
    const prisma = await getPrisma();
    
    // Check if embedding column exists
    const columnExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Fact' 
        AND column_name = 'embedding'
      ) as exists
    `;
    
    const hasEmbeddingColumn = columnExists[0]?.exists ?? false;
    
    // Pre-process calendar dates and prepare merge data outside transaction to avoid timeout
    const factsWithCalendarDates = await Promise.all(
      facts.map(async (fact) => {
        try {
          const calendarDates = await parseCalendarDates({
            subcategory: fact.subcategory,
            timeRef: fact.timeRef,
            content: fact.content,
            dateStr: fact.dateStr,
          });
          return { fact, calendarDates };
        } catch (error) {
          console.error('[TextExplorer Facts] Calendar date parsing failed for fact', {
            subcategory: fact.subcategory,
            error,
          });
          return { fact, calendarDates: [] };
        }
      })
    );
    
    // Pre-process merge data and embeddings for existing facts outside transaction
    // This prevents transaction timeouts from LLM calls
    const factsWithMergeData = await Promise.all(
      factsWithCalendarDates.map(async ({ fact, calendarDates }) => {
        // Check if this fact will merge with an existing one
        // We'll do a quick lookup to see if there's a match
        const factWeek = extractWeekNumber(fact.dateStr, fact.timeRef);
        const factDate = normalizeIsoDate(fact.dateStr);
        const subcategoryLower = (fact.subcategory || '').toLowerCase().trim();
        
        let mergeData: {
          existingId?: string;
          mergedContent?: string;
          mergedSourceText?: string;
          updatedEmbedding?: number[];
          newEntities?: string[];
        } | null = null;
        
        if (hasTemporalIdentity(factWeek, factDate) || fact.subcategory) {
          // Quick lookup for existing fact (outside transaction), scoped by space
          const candidates = await (async () => {
            if (spaceId) {
              return prisma.$queryRawUnsafe<Array<{
                id: string;
                content: string;
                sourceText: string | null;
                entities: string;
                dateStr: string | null;
                timeRef: string | null;
                subcategory: string | null;
              }>>(
                `
                SELECT id, content, "sourceText", entities, "dateStr", "timeRef", subcategory
                FROM "Fact"
                WHERE category = $1
                  AND "spaceId" = $4
                  AND (
                    LOWER(TRIM(subcategory)) = $2
                    OR LOWER(TRIM(subcategory)) LIKE $3
                    OR $2 LIKE CONCAT('%', LOWER(TRIM(subcategory)), '%')
                  )
                LIMIT 10
                `,
                fact.category,
                subcategoryLower,
                `%${subcategoryLower}%`,
                spaceId
              );
            }

            // Global/legacy facts (no space) should only dedupe with other global facts
            return prisma.$queryRawUnsafe<Array<{
              id: string;
              content: string;
              sourceText: string | null;
              entities: string;
              dateStr: string | null;
              timeRef: string | null;
              subcategory: string | null;
            }>>(
              `
              SELECT id, content, "sourceText", entities, "dateStr", "timeRef", subcategory
              FROM "Fact"
              WHERE category = $1
                AND "spaceId" IS NULL
                AND (
                  LOWER(TRIM(subcategory)) = $2
                  OR LOWER(TRIM(subcategory)) LIKE $3
                  OR $2 LIKE CONCAT('%', LOWER(TRIM(subcategory)), '%')
                )
              LIMIT 10
              `,
              fact.category,
              subcategoryLower,
              `%${subcategoryLower}%`
            );
          })();
          
          // Filter candidates
          const filteredCandidates = candidates.filter(candidate => {
            const candidateSub = (candidate.subcategory || '').toLowerCase().trim();
            if (candidateSub === subcategoryLower) return true;
            if (candidateSub.includes(subcategoryLower) || subcategoryLower.includes(candidateSub)) {
              const shorter = candidateSub.length < subcategoryLower.length ? candidateSub : subcategoryLower;
              const longer = candidateSub.length >= subcategoryLower.length ? candidateSub : subcategoryLower;
              return shorter.length >= 4 && longer.includes(shorter);
            }
            return false;
          });
          
          // Find matching candidate
          const existing = filteredCandidates.find((candidate) => {
            const candidateWeek = extractWeekNumber(candidate.dateStr, candidate.timeRef);
            const candidateDate = normalizeIsoDate(candidate.dateStr);
            
            if (hasTemporalIdentity(factWeek, factDate) && hasTemporalIdentity(candidateWeek, candidateDate)) {
              return isSameCardTime(factWeek, factDate, candidateWeek, candidateDate);
            }
            return true; // Match by subcategory if no temporal identity
          });
          
          if (existing) {
            // Perform merge and embedding generation outside transaction
            const existingEntities = JSON.parse(existing.entities || '[]') as string[];
            const newEntities = new Set([...existingEntities, ...(fact.entities || [])]);
            
            let mergedContent = existing.content;
            let mergedSourceText = existing.sourceText || '';
            
            const shouldUseLLMMerge = fact.content && 
              fact.content !== existing.content && 
              !existing.content.includes(fact.content) &&
              fact.content.length > 20;
            
            if (shouldUseLLMMerge) {
              try {
                const mergePrompt = `You are updating an existing event/fact card with new information from a Slack announcement.

EXISTING CARD:
Content: "${existing.content}"
Source: "${existing.sourceText || 'N/A'}"
Time: "${existing.timeRef || 'N/A'}"
Date: "${existing.dateStr || 'N/A'}"

NEW INFORMATION FROM SLACK:
Content: "${fact.content}"
Source: "${fact.sourceText || 'N/A'}"
Time: "${fact.timeRef || 'N/A'}"
Date: "${fact.dateStr || 'N/A'}"

Your task:
1. Create an UPDATED content summary (1-2 sentences) that incorporates the new information
2. Keep the most important and up-to-date details
3. If dates/times conflict, prefer the newer information
4. CRITICAL: If new details include URLs, links, or RSVP forms, ALWAYS include them in the merged content
5. Preserve important context from the original that's still relevant
6. In mergedSourceText, put the NEW information first, then the original source

Return JSON: { "mergedContent": "updated summary here with links preserved", "mergedSourceText": "new info first, then original" }`;

                const mergeResponse = await openai.chat.completions.create({
                  model: 'gpt-4o-mini',
                  messages: [
                    {
                      role: 'system',
                      content: 'You are a helpful assistant that intelligently merges event information. Return only valid JSON.',
                    },
                    {
                      role: 'user',
                      content: mergePrompt,
                    },
                  ],
                  response_format: { type: 'json_object' },
                  temperature: 0.2,
                  max_tokens: 500,
                });

                const mergeResult = JSON.parse(mergeResponse.choices[0]?.message?.content || '{}');
                if (mergeResult.mergedContent) {
                  mergedContent = mergeResult.mergedContent;
                }
                if (mergeResult.mergedSourceText) {
                  mergedSourceText = mergeResult.mergedSourceText;
                } else {
                  if (fact.sourceText && fact.sourceText !== existing.sourceText && !mergedSourceText.includes(fact.sourceText)) {
                    mergedSourceText = `${fact.sourceText}\n\n${mergedSourceText}`.trim();
                  }
                }
              } catch (error) {
                console.error('[TextExplorer Facts] LLM merge failed, using simple merge', error);
                mergedContent = `${existing.content} ${fact.content}`.trim();
                if (fact.sourceText && fact.sourceText !== existing.sourceText && !mergedSourceText.includes(fact.sourceText)) {
                  mergedSourceText = `${fact.sourceText}\n\n${mergedSourceText}`.trim();
                }
              }
            } else {
              if (fact.content && fact.content !== existing.content && !existing.content.includes(fact.content)) {
                mergedContent = `${existing.content} ${fact.content}`.trim();
              }
              if (fact.sourceText && fact.sourceText !== existing.sourceText && !mergedSourceText.includes(fact.sourceText)) {
                mergedSourceText = `${fact.sourceText}\n\n${mergedSourceText}`.trim();
              }
            }
            
            // Generate embedding outside transaction
            const embeddingParts = [
              existing.subcategory || fact.subcategory || '',
              mergedContent,
              mergedSourceText,
              existing.timeRef || fact.timeRef || '',
              existing.dateStr || fact.dateStr || ''
            ].filter(Boolean);
            const embeddingText = embeddingParts.join(' ').trim();
            const updatedEmbedding = await embedText(embeddingText);
            
            mergeData = {
              existingId: existing.id,
              mergedContent,
              mergedSourceText,
              updatedEmbedding,
              newEntities: Array.from(newEntities)
            };
          }
        }
        
        return { fact, calendarDates, mergeData };
      })
    );

    // Use interactive transaction with increased timeout (60s) for async upserts
    // Note: LLM merge and embedding generation happen inside transaction but timeout is increased
    await prisma.$transaction(async (tx) => {
      for (const { fact, calendarDates } of factsWithCalendarDates) {
        // Compute temporal identity from week + ISO date for card identity
        const factWeek = extractWeekNumber(fact.dateStr, fact.timeRef);
        const factDate = normalizeIsoDate(fact.dateStr);
        const subcategoryLower = (fact.subcategory || '').toLowerCase().trim();

        const factEmbedding =
          fact.embedding && fact.embedding.length === VECTOR_DIMENSION
            ? fact.embedding
            : null;
        const hasEmbedding = hasEmbeddingColumn && factEmbedding !== null;

        type Candidate = {
          id: string;
          content: string;
          sourceText: string | null;
          entities: string;
          dateStr: string | null;
          timeRef: string | null;
          subcategory: string | null;
        };

        let existing: Candidate | undefined;

        const baseLog = {
          uploadId,
          category: fact.category,
          subcategory: fact.subcategory,
          timeRef: fact.timeRef,
          dateStr: fact.dateStr,
          week: factWeek,
          isoDate: factDate,
          spaceId,
        };

        // Try to deduplicate - check both facts with temporal identity AND facts without
        // (e.g., "Retreat RSVP" update should merge with existing "Retreat" card)
        if (hasTemporalIdentity(factWeek, factDate) || fact.subcategory) {
          console.log('[TextExplorer Facts] Considering fact for dedup', {
            ...baseLog,
            hasTemporalIdentity: true,
          });

          // Look up candidate facts with same category + similar title (subcategory),
          // scoped to the same space (or global facts with no spaceId)
          // Try exact match first, then fuzzy match for similar names (e.g., "Retreat RSVP" should match "Retreat")
          const candidates = await (async () => {
            if (spaceId) {
              return tx.$queryRawUnsafe<Array<Candidate>>(
                `
                SELECT id,
                       content,
                       "sourceText",
                       entities,
                       "dateStr",
                       "timeRef",
                       subcategory
                FROM "Fact"
                WHERE category = $1
                  AND "spaceId" = $4
                  AND (
                    LOWER(TRIM(subcategory)) = $2
                    OR LOWER(TRIM(subcategory)) LIKE $3
                    OR $2 LIKE CONCAT('%', LOWER(TRIM(subcategory)), '%')
                  )
                `,
                fact.category,
                subcategoryLower,
                `%${subcategoryLower}%`,
                spaceId
              );
            }

            // Global/legacy facts (no space) should only dedupe with other global facts
            return tx.$queryRawUnsafe<Array<Candidate>>(
              `
              SELECT id,
                     content,
                     "sourceText",
                     entities,
                     "dateStr",
                     "timeRef",
                     subcategory
              FROM "Fact"
              WHERE category = $1
                AND "spaceId" IS NULL
                AND (
                  LOWER(TRIM(subcategory)) = $2
                  OR LOWER(TRIM(subcategory)) LIKE $3
                  OR $2 LIKE CONCAT('%', LOWER(TRIM(subcategory)), '%')
                )
              `,
              fact.category,
              subcategoryLower,
              `%${subcategoryLower}%`
            );
          })();
          
          // Filter to only keep candidates where the subcategory is similar enough
          // (e.g., "Retreat RSVP" matches "Retreat", but "Retreat" doesn't match "Ski Trip")
          const filteredCandidates = candidates.filter(candidate => {
            const candidateSub = (candidate.subcategory || '').toLowerCase().trim();
            // Exact match
            if (candidateSub === subcategoryLower) return true;
            // One contains the other (e.g., "retreat" in "retreat rsvp" or vice versa)
            if (candidateSub.includes(subcategoryLower) || subcategoryLower.includes(candidateSub)) {
              // But make sure it's not too different (e.g., "retreat" shouldn't match "great retreat")
              const shorter = candidateSub.length < subcategoryLower.length ? candidateSub : subcategoryLower;
              const longer = candidateSub.length >= subcategoryLower.length ? candidateSub : subcategoryLower;
              // If the shorter is at least 4 chars and is a significant part of the longer, it's a match
              return shorter.length >= 4 && longer.includes(shorter);
            }
            return false;
          });

          console.log('[TextExplorer Facts] Candidate facts for card', {
            ...baseLog,
            candidateCount: candidates.length,
            filteredCount: filteredCandidates.length,
            candidateSummaries: filteredCandidates.slice(0, 5).map((c) => ({
              id: c.id,
              subcategory: c.subcategory,
              dateStr: c.dateStr,
              timeRef: c.timeRef,
              week: extractWeekNumber(c.dateStr, c.timeRef),
              isoDate: normalizeIsoDate(c.dateStr),
            })),
          });

          // Among filtered candidates, treat as the same card using week/date rules:
          // - Same title + same week (even if only one has a date)
          // - Same title + same date (even if only one has a week)
          // - Same title even without matching dates (for updates/RSVPs that don't have dates)
          existing = filteredCandidates.find((candidate) => {
            const candidateWeek = extractWeekNumber(
              candidate.dateStr,
              candidate.timeRef
            );
            const candidateDate = normalizeIsoDate(candidate.dateStr);
            
            // If both have temporal identity, use strict matching
            if (hasTemporalIdentity(factWeek, factDate) && hasTemporalIdentity(candidateWeek, candidateDate)) {
            return isSameCardTime(
              factWeek,
              factDate,
              candidateWeek,
              candidateDate
            );
            }
            
            // If new fact has no temporal identity but candidate does, still match (update/RSVP)
            // If candidate has no temporal identity but new fact does, still match (adding date to existing)
            // If neither has temporal identity, match by subcategory only
            return true;
          });

          if (existing) {
            console.log('[TextExplorer Facts] Deduping into existing card', {
              ...baseLog,
              existingId: existing.id,
            });
          } else {
            console.log('[TextExplorer Facts] No matching card found, inserting new', baseLog);
          }
        } else if (!fact.subcategory) {
          // Only skip deduplication if there's no subcategory at all
          console.log('[TextExplorer Facts] No subcategory, inserting new card', {
            ...baseLog,
          });
        } else {
          // Fact has subcategory but no temporal identity - still try to match
          console.log('[TextExplorer Facts] No temporal identity but has subcategory, checking for matches', {
            ...baseLog,
            hasTemporalIdentity: false,
          });
          
          // Look for existing facts with similar subcategory (even without temporal matching),
          // scoped to the same space (or global facts with no spaceId)
          const candidates = await (async () => {
            if (spaceId) {
              return tx.$queryRawUnsafe<Array<Candidate>>(
                `
                SELECT id,
                       content,
                       "sourceText",
                       entities,
                       "dateStr",
                       "timeRef",
                       subcategory
                FROM "Fact"
                WHERE category = $1
                  AND "spaceId" = $4
                  AND (
                    LOWER(TRIM(subcategory)) = $2
                    OR LOWER(TRIM(subcategory)) LIKE $3
                    OR $2 LIKE CONCAT('%', LOWER(TRIM(subcategory)), '%')
                  )
                `,
                fact.category,
                subcategoryLower,
                `%${subcategoryLower}%`,
                spaceId
              );
            }

            // Global/legacy facts (no space) should only dedupe with other global facts
            return tx.$queryRawUnsafe<Array<Candidate>>(
              `
              SELECT id,
                     content,
                     "sourceText",
                     entities,
                     "dateStr",
                     "timeRef",
                     subcategory
              FROM "Fact"
              WHERE category = $1
                AND "spaceId" IS NULL
                AND (
                  LOWER(TRIM(subcategory)) = $2
                  OR LOWER(TRIM(subcategory)) LIKE $3
                  OR $2 LIKE CONCAT('%', LOWER(TRIM(subcategory)), '%')
                )
              `,
              fact.category,
              subcategoryLower,
              `%${subcategoryLower}%`
            );
          })();
          
          const filteredCandidates = candidates.filter(candidate => {
            const candidateSub = (candidate.subcategory || '').toLowerCase().trim();
            if (candidateSub === subcategoryLower) return true;
            if (candidateSub.includes(subcategoryLower) || subcategoryLower.includes(candidateSub)) {
              const shorter = candidateSub.length < subcategoryLower.length ? candidateSub : subcategoryLower;
              const longer = candidateSub.length >= subcategoryLower.length ? candidateSub : subcategoryLower;
              return shorter.length >= 4 && longer.includes(shorter);
            }
            return false;
          });
          
          // For facts without temporal identity, match to the most recent similar fact
          if (filteredCandidates.length > 0) {
            // Prefer facts with temporal identity (actual events) over facts without
            const withTemporal = filteredCandidates.filter(c => {
              const cWeek = extractWeekNumber(c.dateStr, c.timeRef);
              const cDate = normalizeIsoDate(c.dateStr);
              return hasTemporalIdentity(cWeek, cDate);
            });
            
            existing = (withTemporal.length > 0 ? withTemporal : filteredCandidates)[0];
            
            if (existing) {
              console.log('[TextExplorer Facts] Found matching card without temporal identity', {
                ...baseLog,
                existingId: existing.id,
                existingSubcategory: existing.subcategory,
              });
            }
          }
        }

        const calendarDatesJson = calendarDates.length > 0 ? JSON.stringify(calendarDates) : null;

        // Prepare merge data outside transaction to avoid timeout
        let mergedContent: string = fact.content;
        let mergedSourceText: string = fact.sourceText || '';
        let updatedEmbedding: number[] | null = null;

        if (existing) {
          // Merge with existing fact using LLM for intelligent updates
          const existingFact = existing;
          const existingEntities = JSON.parse(existingFact.entities || '[]') as string[];
          const newEntities = new Set([...existingEntities, ...(fact.entities || [])]);
          
          // Use LLM to intelligently merge content
          mergedContent = existingFact.content;
          mergedSourceText = existingFact.sourceText || '';
          
          // If new information is significantly different, use LLM to merge intelligently
          const shouldUseLLMMerge = fact.content && 
            fact.content !== existingFact.content && 
            !existingFact.content.includes(fact.content) &&
            fact.content.length > 20; // Only for substantial new content
          
          if (shouldUseLLMMerge) {
            try {
              const mergePrompt = `You are updating an existing event/fact card with new information from a Slack announcement.

EXISTING CARD:
Content: "${existingFact.content}"
Source: "${existingFact.sourceText || 'N/A'}"
Time: "${existingFact.timeRef || 'N/A'}"
Date: "${existingFact.dateStr || 'N/A'}"

NEW INFORMATION FROM SLACK:
Content: "${fact.content}"
Source: "${fact.sourceText || 'N/A'}"
Time: "${fact.timeRef || 'N/A'}"
Date: "${fact.dateStr || 'N/A'}"

Your task:
1. Create an UPDATED content summary (1-2 sentences) that incorporates the new information
2. Keep the most important and up-to-date details
3. If dates/times conflict, prefer the newer information
4. CRITICAL: If new details include URLs, links, or RSVP forms, ALWAYS include them in the merged content
5. Preserve important context from the original that's still relevant
6. In mergedSourceText, put the NEW information first, then the original source

Return JSON: { "mergedContent": "updated summary here with links preserved", "mergedSourceText": "new info first, then original" }`;

              const mergeResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                  {
                    role: 'system',
                    content: 'You are a helpful assistant that intelligently merges event information. Return only valid JSON.',
                  },
                  {
                    role: 'user',
                    content: mergePrompt,
                  },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.2,
                max_tokens: 500,
              });

              const mergeResult = JSON.parse(mergeResponse.choices[0]?.message?.content || '{}');
              if (mergeResult.mergedContent) {
                mergedContent = mergeResult.mergedContent;
              }
              if (mergeResult.mergedSourceText) {
                mergedSourceText = mergeResult.mergedSourceText;
              } else {
                // Fallback: append new source text
                if (fact.sourceText && fact.sourceText !== existingFact.sourceText && !mergedSourceText.includes(fact.sourceText)) {
                  mergedSourceText = `${fact.sourceText}\n\n${mergedSourceText}`.trim();
                }
              }
            } catch (error) {
              console.error('[TextExplorer Facts] LLM merge failed, using simple merge', error);
              // Fallback to simple merge
              mergedContent = `${existingFact.content} ${fact.content}`.trim();
              if (fact.sourceText && fact.sourceText !== existingFact.sourceText && !mergedSourceText.includes(fact.sourceText)) {
                mergedSourceText = `${fact.sourceText}\n\n${mergedSourceText}`.trim();
              }
            }
          } else {
            // Simple merge for minor updates
          if (fact.content && fact.content !== existingFact.content && !existingFact.content.includes(fact.content)) {
            mergedContent = `${existingFact.content} ${fact.content}`.trim();
            }
            if (fact.sourceText && fact.sourceText !== existingFact.sourceText && !mergedSourceText.includes(fact.sourceText)) {
              mergedSourceText = `${fact.sourceText}\n\n${mergedSourceText}`.trim();
            }
          }
          
          // Regenerate embedding with merged content for better search (outside transaction to avoid timeout)
          // Include subcategory, content, sourceText, and timeRef for comprehensive embedding
          const embeddingParts = [
            existingFact.subcategory || fact.subcategory || '',
            mergedContent,
            mergedSourceText,
            existingFact.timeRef || fact.timeRef || '',
            existingFact.dateStr || fact.dateStr || ''
          ].filter(Boolean);
          const embeddingText = embeddingParts.join(' ').trim();
          
          // Generate embedding outside transaction to prevent timeout
          // We'll store it and use it in the update
          try {
            updatedEmbedding = await embedText(embeddingText);
          } catch (error) {
            console.error('[TextExplorer Facts] Embedding generation failed during merge', error);
            updatedEmbedding = null;
          }
        }
        
        // Update existing fact if we have merge data
        if (existing && mergedContent && mergedSourceText !== undefined) {
          const existingFact = existing;
          const existingEntities = JSON.parse(existingFact.entities || '[]') as string[];
          const newEntities = new Set([
            ...existingEntities,
            ...(fact.entities || [])
          ]);
          
          // Update existing fact (include calendarDates and updated embedding)
          if (hasEmbeddingColumn && updatedEmbedding && updatedEmbedding.length === VECTOR_DIMENSION) {
            await tx.$executeRawUnsafe(
              `
              UPDATE "Fact"
              SET content = $1,
                  "sourceText" = $2,
                  entities = $3,
                  "calendarDates" = $4,
                  embedding = $5::vector,
                  "spaceId" = COALESCE("spaceId", $6)
              WHERE id = $7
              `,
              mergedContent,
              mergedSourceText,
              JSON.stringify(Array.from(newEntities)),
              calendarDatesJson,
              `[${updatedEmbedding.join(',')}]`,
              spaceId || null,
              existingFact.id
            );
          } else {
            await tx.$executeRawUnsafe(
              `
              UPDATE "Fact"
              SET content = $1,
                  "sourceText" = $2,
                  entities = $3,
                  "calendarDates" = $4,
                  "spaceId" = COALESCE("spaceId", $5)
              WHERE id = $6
              `,
              mergedContent,
              mergedSourceText || '',
              JSON.stringify(Array.from(newEntities)),
              calendarDatesJson,
              spaceId || null,
              existingFact.id
            );
          }
        } else {
          // Insert new fact (include calendarDates)
          const embedding = factEmbedding ?? Array.from({ length: VECTOR_DIMENSION }, () => 0);
          
          if (hasEmbeddingColumn && hasEmbedding && factEmbedding) {
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "Fact" 
                (id, "uploadId", content, "sourceText", category, subcategory, "timeRef", "dateStr", "calendarDates", entities, embedding, "spaceId")
              VALUES 
                (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, $11)
              `,
              uploadId,
              fact.content,
              fact.sourceText,
              fact.category,
              fact.subcategory,
              fact.timeRef,
              fact.dateStr,
              calendarDatesJson,
              JSON.stringify(fact.entities),
              `[${factEmbedding.join(',')}]`,
              spaceId || null
            );
          } else {
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "Fact" 
                (id, "uploadId", content, "sourceText", category, subcategory, "timeRef", "dateStr", "calendarDates", entities, "spaceId")
              VALUES 
                (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              `,
              uploadId,
              fact.content,
              fact.sourceText,
              fact.category,
              fact.subcategory,
              fact.timeRef,
              fact.dateStr,
              calendarDatesJson,
              JSON.stringify(fact.entities),
              spaceId || null
            );
          }
        }
      }
    }, { timeout: 60000 }); // 60 second timeout to allow for LLM merge and embedding generation
  },
};

