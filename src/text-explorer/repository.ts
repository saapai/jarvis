import { prisma } from '@/lib/prisma';
import { TextExplorerRepository, ExtractedFact } from './types';

export const textExplorerRepository: TextExplorerRepository = {
  async createUpload({ name, rawText }) {
    const upload = await prisma.upload.create({
      data: { name, rawText },
      select: { id: true },
    });
    return { id: upload.id };
  },

  async createFacts({ uploadId, facts }) {
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
          },
        })
      )
    );
  },
};

