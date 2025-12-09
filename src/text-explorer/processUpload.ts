import { ProcessResult, LLMClient } from './types';
import { embedText } from './embeddings';

export async function processUpload(
  rawText: string,
  llm: LLMClient
): Promise<ProcessResult> {
  const facts = await llm.extractFacts(rawText);

  const factsWithEmbeddings = await Promise.all(
    facts.map(async (fact) => {
      try {
        const embeddingInput = fact.sourceText || fact.content;
        const embedding = await embedText(embeddingInput);
        return { ...fact, embedding };
      } catch (error) {
        console.error('Embedding error:', error);
        return { ...fact, embedding: [] };
      }
    })
  );

  return { facts: factsWithEmbeddings };
}




