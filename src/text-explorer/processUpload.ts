import { ProcessResult, LLMClient } from './types';
import { embedText } from './embeddings';

export async function processUpload(
  rawText: string,
  llm: LLMClient,
  referenceDate?: Date
): Promise<ProcessResult> {
  const facts = await llm.extractFacts(rawText, referenceDate);

  const factsWithEmbeddings = await Promise.all(
    facts.map(async (fact) => {
      const embeddingInput = fact.sourceText || fact.content;
      const embedding = await embedText(embeddingInput);
      return { ...fact, embedding };
    })
  );

  return { facts: factsWithEmbeddings };
}




