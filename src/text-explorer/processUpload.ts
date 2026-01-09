import { ProcessResult, LLMClient, ExtractedFact } from './types';

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

function dedupeFacts(facts: ExtractedFact[]): ExtractedFact[] {
  const map = new Map<string, ExtractedFact>();

  for (const fact of facts) {
    // Normalize week references for deduplication key
    const normalizedTime = normalizeWeekRef(fact.dateStr, fact.timeRef);
    
    const key = [
      fact.category,
      (fact.subcategory || '').toLowerCase().trim(),
      normalizedTime,
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




