import { NextRequest, NextResponse } from 'next/server';
import { getPrisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import { RootCategory } from '@/text-explorer/types';

async function parseCalendarDates(fact: {
  subcategory?: string | null;
  timeRef?: string | null;
  content?: string;
  dateStr?: string | null;
}): Promise<string[]> {
  if (!fact.timeRef && !fact.content && !fact.dateStr) return [];
  
  try {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();
    
    const prompt = `Extract ALL dates for this event and return them as an array of YYYY-MM-DD dates.

CRITICAL: If the event spans multiple days, return ALL dates in the range, not just the start and end dates.

Examples of date ranges:
- "January 16 to January 19" -> ["2026-01-16", "2026-01-17", "2026-01-18", "2026-01-19"]
- "jan 16-19" -> ["2026-01-16", "2026-01-17", "2026-01-18", "2026-01-19"]
- "jan 24-25" -> ["2026-01-24", "2026-01-25"]
- "January 16 to January 29" -> ["2026-01-16", "2026-01-17", ..., "2026-01-29"] (all dates)
- "jan 16 to jan 29" -> ["2026-01-16", "2026-01-17", ..., "2026-01-29"] (all dates)

Single dates:
- "January 10" -> ["2026-01-10"]
- "jan 24" -> ["2026-01-24"]

Recurring events (return empty array):
- "every Wednesday" -> []
- "recurring:wednesday" -> []

Today's date: ${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}

Fact information:
- subcategory: "${fact.subcategory || 'none'}"
- timeRef: "${fact.timeRef || 'none'}"
- content: "${fact.content?.substring(0, 300) || 'none'}"
- dateStr: "${fact.dateStr || 'none'}"

Return JSON: { "dates": ["YYYY-MM-DD", ...] }`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise date parser. Extract ALL dates from date ranges, including every day between start and end dates. Return dates in YYYY-MM-DD format.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 500
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(content);
      return parsed.dates || [];
    }
  } catch (error) {
    console.error('[Fact Update] Calendar date parsing failed:', error);
  }
  
  return [];
}

export const dynamic = 'force-dynamic';

const ROOT_CATEGORIES: RootCategory[] = ['social', 'professional', 'pledging', 'events', 'meetings', 'other'];

async function regenerateFactMetadata(
  subcategory: string | null,
  content: string,
  sourceText: string | null
): Promise<{
  category: RootCategory;
  subcategory: string | null;
  timeRef: string | null;
  dateStr: string | null;
  entities: string[];
}> {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();

  try {
    const prompt = `Extract metadata from this fact:

Subcategory: ${subcategory || 'none'}
Content: ${content}
Source Text: ${sourceText || content}

Extract:
1. category: One of: social, professional, pledging, events, meetings, other
2. subcategory: The specific event/topic name (use provided subcategory if valid, otherwise extract from content)
3. timeRef: Time reference if any ("November 8th", "every Wednesday at 8:00 PM", "January 15th", "January 16 to January 19")
4. dateStr: Parse to date format:
   - For date ranges: Store ONLY the start date (e.g., "2026-01-16")
   - For dates WITHOUT year: Use whichever occurrence is closer (past or future)
   - For dates WITH year: Use the year specified
   - Recurring: "recurring:dayname" (e.g., "recurring:wednesday")
   - TBD/unknown: null
5. entities: ALL important entities (people, places, groups, concepts, locations, times)

Today's date: ${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}

Return JSON: { "category": "...", "subcategory": "...", "timeRef": "...", "dateStr": "...", "entities": [...] }`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a fact metadata extractor. Extract category, subcategory, time references, dates, and entities from text.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as {
      category?: string;
      subcategory?: string | null;
      timeRef?: string | null;
      dateStr?: string | null;
      entities?: string[];
    };

    return {
      category: ROOT_CATEGORIES.includes(parsed.category as RootCategory)
        ? (parsed.category as RootCategory)
        : 'other',
      subcategory: parsed.subcategory || null,
      timeRef: parsed.timeRef || null,
      dateStr: parsed.dateStr || null,
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    };
  } catch (error) {
    console.error('LLM metadata regeneration error:', error);
    // Fallback: return minimal metadata
    return {
      category: 'other',
      subcategory: subcategory,
      timeRef: null,
      dateStr: null,
      entities: [],
    };
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json();
    const { subcategory, content, sourceText } = body;

    if (!id) {
      return NextResponse.json({ error: 'Fact ID is required' }, { status: 400 });
    }

    if (subcategory === undefined && content === undefined && sourceText === undefined) {
      return NextResponse.json({ error: 'At least one field must be provided' }, { status: 400 });
    }

    const prisma = await getPrisma();
    
    // Get current fact
    const currentFact = await prisma.fact.findUnique({
      where: { id },
    });

    if (!currentFact) {
      return NextResponse.json({ error: 'Fact not found' }, { status: 404 });
    }

    // Determine what to update
    const newSubcategory = subcategory !== undefined ? subcategory : currentFact.subcategory;
    const newContent = content !== undefined ? content : currentFact.content;
    const newSourceText = sourceText !== undefined ? sourceText : currentFact.sourceText;

    // Regenerate metadata using LLM
    const metadata = await regenerateFactMetadata(
      newSubcategory,
      newContent,
      newSourceText || newContent
    );

    // Parse calendar dates server-side
    const calendarDates = await parseCalendarDates({
      subcategory: newSubcategory,
      timeRef: metadata.timeRef,
      content: newContent,
      dateStr: metadata.dateStr,
    });
    const calendarDatesJson = calendarDates.length > 0 ? JSON.stringify(calendarDates) : null;

    // Update fact with new values and regenerated metadata
    const updatedFact = await prisma.fact.update({
      where: { id },
      data: {
        subcategory: newSubcategory,
        content: newContent,
        sourceText: newSourceText,
        category: metadata.category,
        timeRef: metadata.timeRef,
        dateStr: metadata.dateStr,
        calendarDates: calendarDatesJson,
        entities: JSON.stringify(metadata.entities),
      },
      include: {
        upload: { select: { name: true } },
      },
    });

    return NextResponse.json({
      fact: {
        id: updatedFact.id,
        content: updatedFact.content,
        sourceText: updatedFact.sourceText,
        category: updatedFact.category,
        subcategory: updatedFact.subcategory,
        timeRef: updatedFact.timeRef,
        dateStr: updatedFact.dateStr,
        entities: JSON.parse(updatedFact.entities),
        uploadName: updatedFact.upload.name,
        createdAt: updatedFact.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Fact update error:', error);
    return NextResponse.json({ error: 'Failed to update fact' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    if (!id) {
      return NextResponse.json({ error: 'Fact ID is required' }, { status: 400 });
    }

    const prisma = await getPrisma();
    
    // Check if fact exists
    const fact = await prisma.fact.findUnique({
      where: { id },
    });

    if (!fact) {
      return NextResponse.json({ error: 'Fact not found' }, { status: 404 });
    }

    // Delete the fact
    await prisma.fact.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Fact delete error:', error);
    return NextResponse.json({ error: 'Failed to delete fact' }, { status: 500 });
  }
}

