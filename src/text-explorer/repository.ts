import { getPrisma } from '@/lib/prisma';
import { TextExplorerRepository, ExtractedFact } from './types';
import { emptyVector } from './embeddings';

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
    await prisma.$transaction(
      facts.map((fact) =>
        prisma.fact.create({
          data: {
            uploadId,
            content: fact.content,
            sourceText: fact.sourceText,
            category: fact.category,
            subcategory: fact.subcategory,
            timeRef: fact.timeRef,
            dateStr: fact.dateStr,
            entities: JSON.stringify(fact.entities),
            embedding: fact.embedding && fact.embedding.length > 0 ? fact.embedding : emptyVector(),
          },
        })
      )
    );
  },
};

