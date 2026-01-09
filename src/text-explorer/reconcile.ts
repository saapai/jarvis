import { getPrisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import type { RootCategory } from './types';

type LiteFact = {
  id: string;
  content: string;
  subcategory: string | null;
  category: RootCategory;
  timeRef: string | null;
  dateStr: string | null;
  uploadId: string;
};

type MergePlan = {
  targetId: string;
  mergeIds: string[];
};

async function getMergePlanForGroup(facts: LiteFact[]): Promise<MergePlan[]> {
  if (facts.length <= 1) return [];

  try {
    const system = `
You are helping deduplicate event cards for a club calendar.

Each card has:
- id
- category
- subcategory (title)
- content (1–2 sentence summary)
- timeRef (human time phrase: "week 3", "week 3 weekend, Jan 24–25")
- dateStr (normalized machine date like "2026-01-24" or "week:3")

Two cards should be MERGED when they clearly describe the SAME event:
- Same subcategory/title (e.g., "Ski Trip", "Retreat")
- Their timing clearly matches:
  * Same explicit calendar date, OR
  * One mentions a week (e.g., "week 3") and the other has an exact date you can tell is that week (e.g., "Jan 24" & "week 3 (Jan 24)"),
  * Or they otherwise unambiguously refer to the same weekend or date.
- Minor wording differences or extra detail in content are OK – treat as the same event.

DO NOT MERGE:
- Cards with the same title but clearly different dates (e.g., Ski Trip on Jan 5 vs Feb 17).
- Cards that seem like different instances of a recurring thing.

Return strict JSON: { "merges": Array<{ "targetId": string, "mergeIds": string[] }> }
- "targetId" is the card to keep.
- "mergeIds" are cards whose info should be merged into target and then deleted.
- Use only IDs that appear in the input list.
`.trim();

    const user = JSON.stringify(
      {
        facts: facts.map((f) => ({
          id: f.id,
          category: f.category,
          subcategory: f.subcategory,
          content: f.content,
          timeRef: f.timeRef,
          dateStr: f.dateStr,
        })),
      },
      null,
      2
    );

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 2000,
    });

    const raw = completion.choices[0]?.message?.content ?? '{"merges": []}';
    const parsed = JSON.parse(raw) as { merges?: MergePlan[] };
    const validIds = new Set(facts.map((f) => f.id));

    const merges: MergePlan[] = (parsed.merges ?? []).map((m) => ({
      targetId: m.targetId,
      mergeIds: (m.mergeIds ?? []).filter((id) => validIds.has(id) && id !== m.targetId),
    }));

    return merges.filter((m) => validIds.has(m.targetId) && m.mergeIds.length > 0);
  } catch (error) {
    console.error('[TextExplorer Reconcile] LLM merge planning error', error);
    return [];
  }
}

export async function reconcileFactsAfterUpload(uploadId: string): Promise<void> {
  const prisma = await getPrisma();

  // Fetch facts from this upload to know which titles to inspect
  const uploadFacts = await prisma.fact.findMany({
    where: { uploadId },
    select: {
      id: true,
      content: true,
      subcategory: true,
      category: true,
      timeRef: true,
      dateStr: true,
      uploadId: true,
    },
  });

  if (uploadFacts.length === 0) return;

  console.log('[TextExplorer Reconcile] Starting reconciliation for upload', {
    uploadId,
    uploadFactCount: uploadFacts.length,
  });

  // Group by category + normalized subcategory (title)
  const groupsByKey = new Map<string, { category: RootCategory; subcategory: string | null }>();
  for (const f of uploadFacts) {
    if (!f.subcategory) continue;
    const key = `${f.category}|${f.subcategory.toLowerCase().trim()}`;
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, { category: f.category as RootCategory, subcategory: f.subcategory });
    }
  }

  for (const [key, meta] of groupsByKey.entries()) {
    const { category, subcategory } = meta;
    const normalizedSub = subcategory ? subcategory.toLowerCase().trim() : null;

    if (!normalizedSub) continue;

    // Pull ALL facts with this title/category across uploads
    const factsForGroup = (await prisma.fact.findMany({
      where: {
        category,
        subcategory: { equals: subcategory },
      },
      select: {
        id: true,
        content: true,
        subcategory: true,
        category: true,
        timeRef: true,
        dateStr: true,
        uploadId: true,
      },
    })) as LiteFact[];

    if (factsForGroup.length <= 1) continue;

    console.log('[TextExplorer Reconcile] Running LLM merge planning for group', {
      uploadId,
      category,
      subcategory,
      factCount: factsForGroup.length,
    });

    const mergePlan = await getMergePlanForGroup(factsForGroup);
    if (!mergePlan.length) continue;

    console.log('[TextExplorer Reconcile] Merge plan received', {
      uploadId,
      category,
      subcategory,
      plan: mergePlan,
    });

    await prisma.$transaction(async (tx) => {
      for (const plan of mergePlan) {
        const target = factsForGroup.find((f) => f.id === plan.targetId);
        if (!target) continue;

        let mergedContent = target.content;
        let mergedSourceText = '';
        const mergedEntities = new Set<string>();

        // Re-fetch full rows for target + mergeIds to get sourceText/entities
        const rows = await tx.fact.findMany({
          where: { id: { in: [plan.targetId, ...plan.mergeIds] } },
          select: {
            id: true,
            content: true,
            sourceText: true,
            entities: true,
          },
        });

        for (const row of rows) {
          if (row.content && !mergedContent.includes(row.content)) {
            mergedContent = `${mergedContent}\n\n${row.content}`.trim();
          }
          if (row.sourceText) {
            if (!mergedSourceText) {
              mergedSourceText = row.sourceText;
            } else if (!mergedSourceText.includes(row.sourceText)) {
              mergedSourceText = `${mergedSourceText}\n\n${row.sourceText}`.trim();
            }
          }
          try {
            const parsed = JSON.parse(row.entities || '[]') as string[];
            for (const e of parsed) mergedEntities.add(e);
          } catch {
            // ignore parse errors
          }
        }

        console.log('[TextExplorer Reconcile] Applying merge', {
          uploadId,
          category,
          subcategory,
          targetId: plan.targetId,
          mergeIds: plan.mergeIds,
        });

        await tx.fact.update({
          where: { id: plan.targetId },
          data: {
            content: mergedContent,
            sourceText: mergedSourceText || null,
            entities: JSON.stringify(Array.from(mergedEntities)),
          },
        });

        if (plan.mergeIds.length > 0) {
          await tx.fact.deleteMany({
            where: { id: { in: plan.mergeIds } },
          });
        }
      }
    });
  }

  console.log('[TextExplorer Reconcile] Completed reconciliation for upload', {
    uploadId,
  });
}


