import { getPrisma } from '@/lib/prisma';
import { TextExplorerRepository, ExtractedFact } from './types';
import { VECTOR_DIMENSION } from './embeddings';

/**
 * Compute a normalized time key for "card" identity:
 * - Any "week 3", "week:3", "week 3 weekend" → "week:3"
 * - Real ISO dates (YYYY-MM-DD) are kept as-is
 * - Everything else falls back to a lowercase/trimmed combined string
 *
 * This is intentionally shared logic with the in-memory deduper so that
 * cards are identified the same way within an upload and across uploads.
 */
function normalizeTimeKey(dateStr?: string | null, timeRef?: string | null): string {
  const dateLower = (dateStr || '').toLowerCase().trim();
  const timeLower = (timeRef || '').toLowerCase().trim();
  const combined = [dateLower, timeLower].filter(Boolean).join(' ');

  // Extract week number from anything like "week 3", "week:3", "week 3 weekend"
  const weekMatch = combined.match(/\bweek\s*:?\s*(\d+)\b/);
  if (weekMatch) {
    return `week:${weekMatch[1]}`;
  }

  // Keep real ISO dates as-is
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    return dateStr.trim();
  }

  // Fallback: normalized combined string (can be empty)
  return combined;
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
        // Compute normalized time key from dateStr / timeRef for card identity
        const normalizedTime = normalizeTimeKey(fact.dateStr, fact.timeRef);
        const subcategoryLower = (fact.subcategory || '').toLowerCase().trim();

        // Look up candidate facts with same category + title (subcategory, case-insensitive)
        const candidates = await tx.$queryRawUnsafe<Array<{
          id: string;
          content: string;
          sourceText: string | null;
          entities: string;
          dateStr: string | null;
          timeRef: string | null;
        }>>(
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

        // Among candidates, treat as the same card when the normalized time key matches:
        // - Same title + same week (even if only one has a date in addition)
        // - Or same title + same date
        const existing = candidates.find((candidate) => {
          const candidateNormalized = normalizeTimeKey(
            candidate.dateStr,
            candidate.timeRef
          );
          return candidateNormalized === normalizedTime;
        });
        
        const factEmbedding = fact.embedding && fact.embedding.length === VECTOR_DIMENSION
          ? fact.embedding
          : null;
        const hasEmbedding = hasEmbeddingColumn && factEmbedding !== null;
        
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

