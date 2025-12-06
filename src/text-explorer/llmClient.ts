import { openai } from '@/lib/openai';
import { ExtractedFact, LLMClient, RootCategory } from './types';

const ROOT_CATEGORIES: RootCategory[] = ['social', 'professional', 'pledging', 'events', 'meetings', 'other'];

export const llmClient: LLMClient = {
  async extractFacts(text: string): Promise<ExtractedFact[]> {
    const currentYear = new Date().getFullYear();
    
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an information extractor. Split the text into logical sections/topics and extract facts.

For each distinct topic/section in the text, create ONE fact entry with:
1. content: A brief 1-2 sentence summary of the key points
2. sourceText: The FULL original text for that section (preserve exact wording)
3. category: One of: social, professional, pledging, events, meetings, other
4. subcategory: The specific event/topic name (e.g., "Study Hall", "Creatathon", "Big Little")
5. timeRef: The exact time reference ("November 8th", "every Wednesday at 8:00 PM")
6. dateStr: Parse to date format:
   - Specific dates: "${currentYear}-MM-DD" (e.g., "${currentYear}-11-08")
   - Recurring: "recurring:dayname" (e.g., "recurring:wednesday")
   - TBD/unknown: null
7. entities: ALL important entities (people, places, groups, concepts, locations, times)

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


