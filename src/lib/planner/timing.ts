/**
 * Conversation-timing awareness. Turns the gap since the previous message into a plain
 * instruction the reply LLMs can act on — so back-to-back texts feel like one live
 * thread, and a message after a long gap is treated as a fresh start rather than
 * assuming the person remembers what was said hours or days ago.
 *
 * Generic on purpose: no hardcoded topics, just time. `recentMessages` always ends with
 * the current inbound, so the previous entry is the last real turn.
 */
export function describeConversationTiming(
  recentMessages?: Array<{ direction: 'inbound' | 'outbound'; createdAt: Date; text?: string }>
): string {
  if (!recentMessages || recentMessages.length < 2) return ''
  const prev = recentMessages[recentMessages.length - 2]
  if (!prev?.createdAt) return ''

  const gapMs = Date.now() - new Date(prev.createdAt).getTime()
  const min = Math.round(gapMs / 60000)

  if (min <= 3) {
    return "TIMING: this came in moments after the last message — it's a continuous, live back-and-forth. Stay in the flow and build on what was just said; do NOT re-introduce yourself or re-explain what they just heard."
  }
  if (min <= 45) {
    return `TIMING: about ${min} min since the last message — same conversation, short pause. Pick up naturally, no need to reset.`
  }
  const hrs = Math.round(min / 60)
  if (hrs <= 6) {
    return `TIMING: ~${hrs}h since the last message — loosely the same session. A light callback is fine, but don't assume they're mid-thought.`
  }
  const days = Math.round(hrs / 24)
  const ago = days >= 1 ? `${days} day${days > 1 ? 's' : ''}` : `${hrs}h`
  return `TIMING: it's been ${ago} since the last message — treat this as a fresh start. Don't assume they remember the earlier thread; answer this on its own terms.`
}

/** Compact recent transcript (last few turns) for handlers that don't already build one. */
export function buildRecentTranscript(
  recentMessages?: Array<{ direction: 'inbound' | 'outbound'; text?: string }>,
  turns = 6,
  cap = 180
): string {
  if (!recentMessages || recentMessages.length === 0) return ''
  return recentMessages
    .slice(-turns)
    .map(m => `${m.direction === 'inbound' ? 'User' : 'Jarvis'}: ${(m.text || '').slice(0, cap)}`)
    .join('\n')
}
