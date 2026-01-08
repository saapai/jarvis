import { openai } from '@/lib/openai';
import { ExtractedFact, LLMClient, RootCategory } from './types';

const ROOT_CATEGORIES: RootCategory[] = ['social', 'professional', 'pledging', 'events', 'meetings', 'other'];

export const llmClient: LLMClient = {
  async extractFacts(text: string): Promise<ExtractedFact[]> {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate();
    
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an information extractor. Split the text into logical sections/topics and extract facts.

Today's date: ${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}

For each distinct topic/section in the text, create ONE fact entry with:
1. content: A brief 1-2 sentence summary of the key points
2. sourceText: The FULL original text for that section (preserve exact wording)
3. category: One of: social, professional, pledging, events, meetings, other
4. subcategory: The specific event/topic name (e.g., "Study Hall", "Creatathon", "Big Little")
5. timeRef: The exact time reference ("November 8th", "every Wednesday at 8:00 PM", "January 15th", "January 16 to January 19", "jan 16-19")
6. dateStr: Parse to date format. IMPORTANT: For date RANGES, store only the START date:
   - For date ranges (e.g., "January 16 to January 19", "jan 16-19", "16-19"): Store ONLY the start date (e.g., "2026-01-16")
     The full range information should be in timeRef so it can be parsed later
   - For dates WITHOUT a year specified: Determine which occurrence is closer (past or future):
     * Calculate days to past occurrence (this year) 
     * Calculate days to future occurrence (next year)
     * Use whichever is closer
     * Example: If today is Dec 26, "November 8" -> past is 48 days ago, future is 317 days away, so use ${currentYear}-11-08
     * Example: If today is Dec 26, "February 5" -> past is 325 days ago, future is 41 days away, so use ${currentYear + 1}-02-05
   - Specific dates WITH year: Use the year specified (e.g., "November 8th, 2025" -> "2025-11-08")
   - Recurring: "recurring:dayname" (e.g., "recurring:wednesday")
   - TBD/unknown: null
7. entities: ALL important entities (people, places, groups, concepts, locations, times)

CRITICAL RULE FOR DATES WITHOUT YEAR:
- Calculate distance to BOTH the past occurrence (earlier this year) and future occurrence (next year)
- Use whichever date is CLOSER to today
- This ensures "November 8" in December refers to the recent past November, not next year's November

IMPORTANT RULES:
- Group related sentences about the same topic into ONE fact
- sourceText should be the COMPLETE original text for that section
- Extract ALL entities mentioned (names, places, times, concepts)
- Entities should include things that could be clickable/searchable

Example for "Study Hall Pledges do Study Hall at Rieber Terrace...":
{
  "content": "Weekly study session for pledges at Rieber Terrace, 6:30 PM - 12:30 AM every Wednesday",
  "sourceText": "Study Hall Pledges do Study Hall at Rieber Terrace, 9th Floor Lounge, from 6:30 PM to 12:30 AM every Wednesday. Study Hall is a weekly work session where pledges come together to study, collaborate, and stay accountable for their academic and professional commitments.",
  "category": "meetings",
  "subcategory": "Study Hall",
  "timeRef": "every Wednesday, 6:30 PM to 12:30 AM",
  "dateStr": "recurring:wednesday",
  "entities": ["Study Hall", "Rieber Terrace", "9th Floor Lounge", "pledges", "6:30 PM", "12:30 AM", "Wednesday"]
}

Return JSON: { "facts": [...] }`,
          },
          {
            role: 'user',
            content: text,
          },
        ],
        max_tokens: 4000,
      });

      const raw = completion.choices[0]?.message?.content ?? '{"facts":[]}';
      const parsed = JSON.parse(raw) as { facts: ExtractedFact[] };

      return (parsed.facts ?? [])
        .filter((f) => f.content && f.content.length > 0)
        .map((f) => ({
          content: f.content,
          sourceText: f.sourceText || null,
          category: ROOT_CATEGORIES.includes(f.category as RootCategory)
            ? (f.category as RootCategory)
            : 'other',
          subcategory: f.subcategory || null,
          timeRef: f.timeRef || null,
          dateStr: f.dateStr || null,
          entities: Array.isArray(f.entities) ? f.entities : [],
        }));
    } catch (error) {
      console.error('LLM extractFacts error:', error);
      return [];
    }
  },
};












