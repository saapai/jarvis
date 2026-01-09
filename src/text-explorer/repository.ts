import { getPrisma } from '@/lib/prisma';
import { TextExplorerRepository, ExtractedFact } from './types';
import { VECTOR_DIMENSION } from './embeddings';

function normalizeWeekRef(dateStr?: string | null, timeRef?: string | null): string {
  const combined = (dateStr || timeRef || '').toLowerCase().trim();
  
  // Extract week number from formats like "week:3", "week 3", "week3", "Week 3"
  const weekMatch = combined.match(/\bweek\s*:?\s*(\d+)\b/);
  if (weekMatch) {
    return `week:${weekMatch[1]}`;
  }
  
  // For regular dates, normalize ISO format dates
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // For other timeRefs, normalize
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
    
    // Use interactive transaction to handle async operations
    await prisma.$transaction(async (tx) => {
      for (const fact of facts) {
        // Normalize the time reference for matching
        const normalizedTime = normalizeWeekRef(fact.dateStr, fact.timeRef);
        const subcategoryLower = (fact.subcategory || '').toLowerCase().trim();
        
        // Find existing facts with same category and subcategory
        const candidates = await tx.$queryRaw<Array<{
          id: string;
          content: string;
          sourceText: string | null;
          entities: string;
          dateStr: string | null;
          timeRef: string | null;
        }>>`
          SELECT id, content, "sourceText", entities, "dateStr", "timeRef"
          FROM "Fact"
          WHERE category = $1
            AND LOWER(TRIM(subcategory)) = $2
        `,
          fact.category,
          subcategoryLower
        );
        
        // Find matching fact by normalized time reference
        const existing = candidates.find(candidate => {
          const candidateNormalized = normalizeWeekRef(candidate.dateStr, candidate.timeRef);
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

