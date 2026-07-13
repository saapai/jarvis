/**
 * Central model config. Both roles run gpt-4o: routing was upgraded first (a misroute
 * can mean an accidental broadcast), then generation followed — mini's replies kept
 * slipping into repeated closers and copied example lines no matter how the prompt was
 * tightened, and conversation quality is the product. The role split is kept so the
 * two can diverge again in one line if costs ever matter more than voice.
 *
 * - CLASSIFIER_MODEL — the routing brain: one call per inbound message deciding WHAT
 *   to do (announce / send / cancel / answer / chat …).
 * - TEXTER_MODEL — reply generation and every non-routing helper call (chat banter,
 *   draft content, answer prose, name extraction, category detection, follow-up
 *   rewrites).
 *
 * Change a role's model in ONE place here, never in 18 scattered call sites.
 */

export const CLASSIFIER_MODEL = 'gpt-4o'
export const TEXTER_MODEL = 'gpt-4o'
