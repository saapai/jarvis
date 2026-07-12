/**
 * Central model config. Two roles, deliberately split by cost vs. stakes:
 *
 * - CLASSIFIER_MODEL — the routing brain. One call per inbound message that
 *   decides WHAT to do (announce / send / cancel / answer / chat …). A wrong
 *   call here is expensive: a misroute, or worst case an accidental broadcast.
 *   It reads the full conversation context, so it needs real reasoning. Worth
 *   the stronger (pricier) model — it's a single small call per message.
 *
 * - TEXTER_MODEL — reply generation and every non-routing helper call. Once
 *   routing is decided, this writes the actual user-facing text (chat banter,
 *   draft content, answer prose) and handles the cheap side decisions (name
 *   extraction, category detection, vague-follow-up rewrites). Higher token
 *   volume, lower stakes, so the cheaper model keeps costs down.
 *
 * Change a role's model in ONE place here, never in 18 scattered call sites.
 */

export const CLASSIFIER_MODEL = 'gpt-4o'
export const TEXTER_MODEL = 'gpt-4o-mini'
