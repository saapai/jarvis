/**
 * Detail extraction — the heart of "batch by relation".
 *
 * A single stored fact often describes ONE entity with several parallel sub-items:
 * an Alumni Reunion happening in three cities, each with its own date and RSVP link;
 * a dues schedule with per-tier amounts; a rush week with a different event per night.
 * The old pipeline flattened all of that into prose + a loose entities blob, so a query
 * got a blurred answer with the wrong date and missing links.
 *
 * extractDetails reads a fact's text and returns the sub-items as STRUCTURED rows —
 * each label paired with ITS OWN date, url, and location — so retrieval can present the
 * whole set correctly. Single-item facts return [] (nothing to group).
 */

import { TEXTER_MODEL } from '@/lib/planner/models'
import { getPrisma } from '@/lib/prisma'

export interface FactDetail {
  label: string          // the distinguishing name of this sub-item ("Los Angeles", "Tier 1")
  date?: string          // YYYY-MM-DD, only if determinable for THIS sub-item
  url?: string           // the link that belongs to THIS sub-item specifically
  location?: string      // place, if distinct
  note?: string          // any short extra detail
}

interface ExtractInput {
  content: string
  sourceText?: string | null
  entities?: string | null   // JSON array string
  subcategory?: string | null
}

const SYSTEM_PROMPT = `You split ONE stored fact about a college org into its structured sub-details.

Some facts describe a single simple thing (one event, one date, one link) — those have NO sub-details.
Others describe ONE entity with several PARALLEL instances, each with its own date/link/place:
- an Alumni Reunion held in LA, NY, and SF — each city its own date and RSVP link
- a rush week with a different event each night
- a dues schedule with per-tier amounts

Return JSON: { "details": [ { "label", "date", "url", "location", "note" }, ... ] }

RULES:
- Only emit details when there are genuinely MULTIPLE parallel sub-items. A single-item fact → { "details": [] }.
- label = the distinguishing name of the sub-item (the city, the tier, the night). Required.
- date = YYYY-MM-DD ONLY if you can determine it for THIS specific sub-item. Use the given year; if no year is stated assume the upcoming occurrence relative to today. Omit if unknown. NEVER guess a month.
- url = the link that belongs to THIS sub-item and no other. Slack links look like <https://url|Label> — the Label after the pipe tells you which sub-item the url is for (<https://luma.com/x|Los Angeles> → that url is the Los Angeles url). Match every url to the right sub-item. Omit if this sub-item has no link.
- location = the place if it's distinct from the label. Omit otherwise.
- Preserve URLs EXACTLY. Do not invent labels, dates, or links that aren't in the text.

Respond with JSON only.`

export async function extractDetails(input: ExtractInput, todayISO: string): Promise<FactDetail[]> {
  if (!process.env.OPENAI_API_KEY) return []

  // Assemble everything we know about the fact for the model to reconcile.
  let entitiesText = ''
  try {
    const arr = input.entities ? JSON.parse(input.entities) : []
    if (Array.isArray(arr) && arr.length) entitiesText = arr.join(', ')
  } catch { /* ignore malformed entities */ }

  const factText = [
    input.subcategory ? `Title: ${input.subcategory}` : '',
    `Summary: ${input.content}`,
    input.sourceText ? `Original text: ${input.sourceText}` : '',
    entitiesText ? `Extracted entities: ${entitiesText}` : ''
  ].filter(Boolean).join('\n')

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await openai.chat.completions.create({
      model: TEXTER_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Today is ${todayISO}.\n\nFACT:\n${factText}\n\nExtract the structured sub-details.` }
      ],
      temperature: 0,
      response_format: { type: 'json_object' }
    })
    const raw = response.choices[0]?.message?.content
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const details = Array.isArray(parsed?.details) ? parsed.details : []
    // Keep only well-formed detail rows with at least a label.
    return details
      .filter((d: any) => d && typeof d.label === 'string' && d.label.trim())
      .map((d: any) => ({
        label: String(d.label).trim(),
        ...(d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? { date: d.date } : {}),
        ...(d.url && /^https?:\/\//.test(d.url) ? { url: String(d.url).trim() } : {}),
        ...(d.location ? { location: String(d.location).trim() } : {}),
        ...(d.note ? { note: String(d.note).trim() } : {})
      }))
  } catch (error) {
    console.error('[extractDetails] failed:', error)
    return []
  }
}

/**
 * Populate `details` for every fact in an upload. Called after createFacts so newly
 * ingested facts get grouped sub-details (per-city dates+links) just like re-processed
 * ones. Best-effort per fact — one failure never blocks the rest of the upload.
 */
export async function populateDetailsForUpload(uploadId: string): Promise<void> {
  const prisma = await getPrisma()
  const today = new Date().toISOString().slice(0, 10)
  const facts = await prisma.fact.findMany({
    where: { uploadId },
    select: { id: true, content: true, sourceText: true, entities: true, subcategory: true }
  })
  for (const f of facts) {
    try {
      const details = await extractDetails(
        { content: f.content, sourceText: f.sourceText, entities: f.entities, subcategory: f.subcategory },
        today
      )
      await prisma.$executeRawUnsafe(`UPDATE "Fact" SET details = $1 WHERE id = $2`, JSON.stringify(details), f.id)
    } catch (error) {
      console.error('[populateDetailsForUpload] fact failed:', f.id, error)
    }
  }
}
