import { ProcessResult, LLMClient, ExtractedFact } from './types';

// Keep these helpers semantically in sync with the time rules in `repository.ts`
function extractWeekNumber(
  dateStr?: string | null,
  timeRef?: string | null
): number | null {
  const combined = `${dateStr ?? ''} ${timeRef ?? ''}`.toLowerCase();
  const weekMatch = combined.match(/\bweek\s*:?\s*(\d+)\b/);
  if (!weekMatch) return null;
  const parsed = parseInt(weekMatch[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeIsoDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function hasTemporalIdentity(
  week: number | null,
  isoDate: string | null
): boolean {
  return week !== null || isoDate !== null;
}

function isSameCardTime(
  baseWeek: number | null,
  baseDate: string | null,
  otherWeek: number | null,
  otherDate: string | null
): boolean {
  if (!hasTemporalIdentity(baseWeek, baseDate) || !hasTemporalIdentity(otherWeek, otherDate)) {
    return false;
  }

  const weeksEqual =
    baseWeek !== null && otherWeek !== null && baseWeek === otherWeek;
  const datesEqual =
    baseDate !== null && otherDate !== null && baseDate === otherDate;

  if (weeksEqual) {
    if (!baseDate || !otherDate || datesEqual) {
      return true;
    }
  }

  if (datesEqual) {
    if (baseWeek === null || otherWeek === null || weeksEqual) {
      return true;
    }
  }

  return false;
}

function dedupeFacts(facts: ExtractedFact[]): ExtractedFact[] {
  const result: ExtractedFact[] = [];

  for (const fact of facts) {
    const factWeek = extractWeekNumber(fact.dateStr, fact.timeRef);
    const factDate = normalizeIsoDate(fact.dateStr);

    // Facts without a temporal identifier should not be merged away
    if (!hasTemporalIdentity(factWeek, factDate)) {
      result.push({ ...fact });
      continue;
    }

    const subcategoryLower = (fact.subcategory || '').toLowerCase().trim();

    const existingIndex = result.findIndex((existing) => {
      if (
        existing.category !== fact.category ||
        (existing.subcategory || '').toLowerCase().trim() !== subcategoryLower
      ) {
        return false;
      }

      const existingWeek = extractWeekNumber(
        existing.dateStr,
        existing.timeRef
      );
      const existingDate = normalizeIsoDate(existing.dateStr);

      return isSameCardTime(
        factWeek,
        factDate,
        existingWeek,
        existingDate
      );
    });

    if (existingIndex === -1) {
      result.push({ ...fact });
      continue;
    }

    const existing = result[existingIndex];
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

    result[existingIndex] = merged;
  }

  return result;
}

export async function processUpload(
  rawText: string,
  llm: LLMClient
): Promise<ProcessResult> {
  const facts = await llm.extractFacts(rawText);
  const deduped = dedupeFacts(facts);
  return { facts: deduped };
}




