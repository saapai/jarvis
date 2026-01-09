import { ProcessResult, LLMClient, ExtractedFact } from './types';

function dedupeFacts(facts: ExtractedFact[]): ExtractedFact[] {
  const map = new Map<string, ExtractedFact>();

  for (const fact of facts) {
    const key = [
      fact.category,
      (fact.subcategory || '').toLowerCase().trim(),
      (fact.dateStr || fact.timeRef || '').toLowerCase().trim(),
    ].join('|');

    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...fact });
      continue;
    }

    // Merge additional info into existing fact
    const merged: ExtractedFact = { ...existing };

    if (
      fact.content &&
      fact.content !== existing.content &&
      !existing.content.includes(fact.content)
    ) {
      merged.content = `${existing.content} ${fact.content}`.trim();
    }

    if (
      fact.sourceText &&
      fact.sourceText !== existing.sourceText &&
      !(existing.sourceText || '').includes(fact.sourceText)
    ) {
      merged.sourceText = `${existing.sourceText ?? ''}\n\n${fact.sourceText}`.trim();
    }

    const entitySet = new Set<string>(existing.entities || []);
    for (const e of fact.entities || []) {
      entitySet.add(e);
    }
    merged.entities = Array.from(entitySet);

    map.set(key, merged);
  }

  return Array.from(map.values());
}

export async function processUpload(
  rawText: string,
  llm: LLMClient
): Promise<ProcessResult> {
  const facts = await llm.extractFacts(rawText);
  const deduped = dedupeFacts(facts);
  return { facts: deduped };
}




