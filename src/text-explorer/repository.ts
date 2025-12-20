import { getPrisma } from '@/lib/prisma';
import { TextExplorerRepository, ExtractedFact } from './types';
import { VECTOR_DIMENSION } from './embeddings';

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
    
    await prisma.$transaction(
      facts.map((fact) => {
        const factEmbedding = fact.embedding && fact.embedding.length === VECTOR_DIMENSION
          ? fact.embedding
          : null;
        const hasEmbedding = hasEmbeddingColumn && factEmbedding !== null;
        const embedding = factEmbedding ?? Array.from({ length: VECTOR_DIMENSION }, () => 0);

        // Insert via raw SQL to handle pgvector column
        if (hasEmbeddingColumn && hasEmbedding && factEmbedding) {
          return prisma.$executeRawUnsafe(
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
          // Insert without embedding column
          return prisma.$executeRawUnsafe(
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
      })
    );
  },
};

