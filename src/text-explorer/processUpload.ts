import { ProcessResult, LLMClient } from './types';

export async function processUpload(
  rawText: string,
  llm: LLMClient
): Promise<ProcessResult> {
  const facts = await llm.extractFacts(rawText);
  return { facts };
}




