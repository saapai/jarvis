import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';

export async function POST(request: NextRequest) {
  try {
    const { fact } = await request.json();
    
    if (!fact) {
      return NextResponse.json({ error: 'Fact is required' }, { status: 400 });
    }

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
      const dates = parsed.dates || [];
      return NextResponse.json({ dates });
    }

    return NextResponse.json({ dates: [] });
  } catch (error) {
    console.error('[API] Date parsing failed:', error);
    return NextResponse.json({ error: 'Failed to parse dates', dates: [] }, { status: 500 });
  }
}

