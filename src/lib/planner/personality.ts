/**
 * Personality — response templates and quick filler replies.
 * Only the pieces still used downstream survive: response TEMPLATES and
 * getQuickResponse. The old rule-based sass engine (analyzeTone / addSass /
 * comebacks / greeting handlers) was deleted — every handler now speaks in
 * Jarvis's voice directly, via the LLM or clean in-voice templates.
 */

// ============================================
// RESPONSE TEMPLATES
// ============================================

// Vary phrasing so repeat flows don't feel like a form letter
const pick = (options: string[]) => options[Math.floor(Math.random() * options.length)]

export const TEMPLATES = {
  // Draft operations
  draftCreated: (type: string, content: string) =>
    pick([
      `📝 here's the ${type}:\n\n"${content}"\n\nreply "send" to blast it out or tell me to change it`,
      `ok drafted:\n\n"${content}"\n\nsay "send" when you're ready, or tell me what to fix`,
      `here's what i've got:\n\n"${content}"\n\n"send" ships it to everyone. or keep tweaking`,
      `📝 draft's ready:\n\n"${content}"\n\nhit me with "send" or tell me what to change`
    ]),

  draftUpdated: (content: string) =>
    pick([
      `updated:\n\n"${content}"\n\nlooks good? say "send" or keep editing`,
      `fixed it:\n\n"${content}"\n\n"send" when you're happy, or keep going`,
      `new version:\n\n"${content}"\n\nsay "send" to ship it or keep editing`
    ]),

  // Serious content (mandatory, a deadline, ALL-CAPS emphasis, a link) gets a neutral
  // confirmation — a flippant "lucky souls" on a mandatory deadline reads as the bot
  // not getting the stakes. Casual announcements keep the playful voice.
  draftSent: (count: number, content = '') => {
    const serious = /\bmandatory\b|\bdeadline\b|\brequired\b|\bdue\b|https?:\/\//i.test(content) ||
      /\b[A-Z]{4,}\b/.test(content)
    return serious
      ? pick([`sent to ${count} people`, `done — ${count} people got it`, `out to ${count} people`])
      : pick([
          `done. sent to ${count} people`,
          `sent to ${count} people. they can pretend they didn't see it now`,
          `boom — ${count} people just got that`,
          `off it goes. ${count} people notified`
        ])
  },

  draftCancelled: () =>
    pick([
      `scrapped. let me know if you wanna start over`,
      `cancelled. it never happened`,
      `scrapped it. the group chat will never know`
    ]),

  askForContent: (type: string) =>
    type === 'poll'
      ? `what do you wanna ask everyone?`
      : pick([
          `what do you wanna announce?`,
          `ok, what's the announcement?`,
          `what do you want to say? i'll draft it up`
        ]),

  // Errors
  noDraft: () =>
    pick([
      `you don't have anything drafted rn. wanna make an announcement?`,
      `there's nothing drafted to send. start with "announce [message]"`,
      `no draft here. tell me what to announce and i'll write it up`
    ]),

  notAdmin: () =>
    `everyone can send announcements now. what do you want to say?`,

  // Content queries
  noResults: () =>
    pick([
      `idk what you're asking about tbh. try being more specific?`,
      `nothing in my notes on that. got more details?`,
      `drawing a blank on that one. try rephrasing?`
    ]),

  // Capability queries
  capabilities: (_isAdmin: boolean) =>
    `i can:\n📢 send announcements ("announce [message]")\n💬 answer questions about the org\n\njust text me what you need or tell me what to send`,

  // Default fallback
  confused: () =>
    pick([
      `not sure what you mean. need help with something?`,
      `you lost me. what do you need?`,
      `gonna need more than that. what's up?`
    ])
}

// ============================================
// QUICK RESPONSES
// ============================================

/**
 * Get a quick sassy response for simple inputs
 */
export function getQuickResponse(input: string): string | null {
  const lower = input.toLowerCase().trim()
  
  const quickResponses: Record<string, string[]> = {
    'ok': ['k', 'cool', '👍'],
    'k': ['ok', 'yep', '👍'],
    'lol': ['glad you find this amusing', 'lmao', '😂', 'hilarious'],
    'lmao': ['ikr', '💀', 'fr'],
    'bruh': ['what', 'bruh indeed', '🤨'],
    'nice': ['thanks i guess', 'ikr', '✨'],
    'cool': ['i know', 'yep', '👍'],
    'wow': ['ikr amazing', 'i know right', '✨'],
    'damn': ['right?', 'ikr', 'fr'],
    'true': ['facts', 'yep', 'fr fr'],
    'fr': ['fr fr', 'on god', 'facts'],
    'bet': ['bet', '👍', 'cool'],
    'ight': ['aight', '👍', 'bet'],
    'aight': ['cool', '👍', 'bet'],
    'word': ['word', 'fr', '👍'],
    'facts': ['fr', 'on god', 'yep'],
    'idk': ['same tbh', 'fair enough', 'mood'],
    'nvm': ['ok', 'sure', 'k'],
    'mb': ['all good', 'np', 'you\'re fine'],
    'my bad': ['all good', 'np', 'you\'re fine'],
    // NOTE: greetings (hi/hey/yo/sup/hello) intentionally NOT here — they fall
    // through to the LLM so a "hey" gets a varied, interactive reply instead of a
    // canned "what do you need?" funnel. Only pure filler stays canned below.
    'thanks': ['np 🙏', 'you\'re welcome', 'anytime'],
    'thank you': ['np 🙏', 'you\'re welcome', 'anytime'],
    'ty': ['np', 'you got it', 'anytime'],
    'bye': ['later 👋', 'bye. text me if you need anything', 'peace ✌️'],
    'goodbye': ['later 👋', 'bye bye', 'peace ✌️'],
    'later': ['later ✌️', 'peace', 'catch you later'],
    'peace': ['peace ✌️', 'later', 'peace out, stay safe'],
    'gn': ['night 🌙', 'sleep tight', 'later'],
    'cya': ['cya ✌️', 'later', 'peace']
  }

  const responses = quickResponses[lower]
  if (responses) {
    return responses[Math.floor(Math.random() * responses.length)]
  }

  // Handle any number of question marks (?, ??, ???, ?????, etc.) — a confused
  // reaction, not a task request. Keep it light, don't funnel to "what do you need".
  if (/^\?+$/.test(lower)) {
    const qmResponses = ['what\'s up?', 'you good?', 'lost me there', 'what\'s confusing you']
    return qmResponses[Math.floor(Math.random() * qmResponses.length)]
  }

  return null
}
