import { getPrisma } from '@/lib/prisma';
import { TextExplorerRepository, ExtractedFact } from './types';
import { VECTOR_DIMENSION } from './embeddings';

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

export const textExplorerRepository: TextExplorerRepository = {
  async createUpload({ name, rawText }) {
    const prisma = await getPrisma();
    const upload = await prisma.upload.create({
      data: { name, rawText },
      select: { id: true },
    });
    return { id: upload.id };
  },

  async createFacts({ uploadId, facts }) {
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
    
    // Use interactive transaction so async upserts are valid
    await prisma.$transaction(async (tx) => {
      for (const fact of facts) {
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
        };

        let existing: Candidate | undefined;

        // Only try to deduplicate when the fact has a temporal identifier
        if (hasTemporalIdentity(factWeek, factDate)) {
          // Look up candidate facts with same category + title (subcategory, case-insensitive)
          const candidates = await tx.$queryRawUnsafe<Array<Candidate>>(
            `
            SELECT id,
                   content,
                   "sourceText",
                   entities,
                   "dateStr",
                   "timeRef"
            FROM "Fact"
            WHERE category = $1
              AND LOWER(TRIM(subcategory)) = $2
            `,
            fact.category,
            subcategoryLower
          );

          // Among candidates, treat as the same card using week/date rules:
          // - Same title + same week (even if only one has a date)
          // - Same title + same date (even if only one has a week)
          existing = candidates.find((candidate) => {
            const candidateWeek = extractWeekNumber(
              candidate.dateStr,
              candidate.timeRef
            );
            const candidateDate = normalizeIsoDate(candidate.dateStr);
            return isSameCardTime(
              factWeek,
              factDate,
              candidateWeek,
              candidateDate
            );
          });
        }

        if (existing) {
          // Merge with existing fact
          const existingFact = existing;
          const existingEntities = JSON.parse(existingFact.entities || '[]') as string[];
          const newEntities = new Set([...existingEntities, ...(fact.entities || [])]);
          
          // Merge content if new info is present
          let mergedContent = existingFact.content;
          if (fact.content && fact.content !== existingFact.content && !existingFact.content.includes(fact.content)) {
            mergedContent = `${existingFact.content} ${fact.content}`.trim();
          }
          
          // Merge sourceText if new info is present
          let mergedSourceText = existingFact.sourceText || '';
          if (fact.sourceText && fact.sourceText !== existingFact.sourceText && !(existingFact.sourceText || '').includes(fact.sourceText)) {
            mergedSourceText = `${existingFact.sourceText || ''}\n\n${fact.sourceText}`.trim();
          }
          
          // Update existing fact
          if (hasEmbeddingColumn && hasEmbedding && factEmbedding) {
            await tx.$executeRawUnsafe(
              `
              UPDATE "Fact"
              SET content = $1,
                  "sourceText" = $2,
                  entities = $3,
                  embedding = $4::vector
              WHERE id = $5
              `,
              mergedContent,
              mergedSourceText,
              JSON.stringify(Array.from(newEntities)),
              `[${factEmbedding.join(',')}]`,
              existingFact.id
            );
          } else {
            await tx.$executeRawUnsafe(
              `
              UPDATE "Fact"
              SET content = $1,
                  "sourceText" = $2,
                  entities = $3
              WHERE id = $4
              `,
              mergedContent,
              mergedSourceText,
              JSON.stringify(Array.from(newEntities)),
              existingFact.id
            );
          }
        } else {
          // Insert new fact
          const embedding = factEmbedding ?? Array.from({ length: VECTOR_DIMENSION }, () => 0);
          
          if (hasEmbeddingColumn && hasEmbedding && factEmbedding) {
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "Fact" 
                (id, "uploadId", content, "sourceText", category, subcategory, "timeRef", "dateStr", entities, embedding)
              VALUES 
                (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
              `,
              uploadId,
              fact.content,
              fact.sourceText,
              fact.category,
              fact.subcategory,
              fact.timeRef,
              fact.dateStr,
              JSON.stringify(fact.entities),
              `[${factEmbedding.join(',')}]`
            );
          } else {
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "Fact" 
                (id, "uploadId", content, "sourceText", category, subcategory, "timeRef", "dateStr", entities)
              VALUES 
                (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
              `,
              uploadId,
              fact.content,
              fact.sourceText,
              fact.category,
              fact.subcategory,
              fact.timeRef,
              fact.dateStr,
              JSON.stringify(fact.entities)
            );
          }
        }
      }
    });
  },
};

