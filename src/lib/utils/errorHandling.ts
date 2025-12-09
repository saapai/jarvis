/**
 * Error Handling & Retry Utilities
 * Provides retry logic and error recovery mechanisms
 */

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt)
        console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError!
}

/**
 * Check if classification confidence is too low
 */
export function isAmbiguousClassification(confidence: number): boolean {
  return confidence < 0.7
}

/**
 * Handle ambiguous classification by asking clarifying question
 */
export function getAmbiguityClarification(
  action: string,
  confidence: number,
  context: string
): string {
  if (confidence < 0.5) {
    return "not sure what you mean. could you rephrase that?"
  }
  
  if (action === 'draft_write') {
    return "do you want to create an announcement or poll?"
  }
  
  if (action === 'content_query') {
    return "what specifically are you asking about?"
  }
  
  return "hmm, not sure i got that. can you be more specific?"
}

/**
 * Clean up stale data (should be run periodically)
 */
export async function cleanupStaleData(): Promise<void> {
  const draftRepo = await import('@/lib/repositories/draftRepository')
  const convRepo = await import('@/lib/repositories/conversationRepository')
  
  try {
    // Clear drafts older than 24 hours
    const clearedDrafts = await draftRepo.clearStaleDrafts()
    console.log(`[Cleanup] Cleared ${clearedDrafts} stale drafts`)
    
    // Clear conversation states older than 1 hour
    const clearedStates = await convRepo.clearStaleStates()
    console.log(`[Cleanup] Cleared ${clearedStates} stale conversation states`)
  } catch (error) {
    console.error('[Cleanup] Error during cleanup:', error)
  }
}

/**
 * Detect if draft is stale (> 24 hours)
 */
export function isDraftStale(createdAt: number): boolean {
  const oneDayMs = 24 * 60 * 60 * 1000
  return Date.now() - createdAt > oneDayMs
}

/**
 * Detect if conversation state is stale (> 1 hour)
 */
export function isStateStale(updatedAt: Date): boolean {
  const oneHourMs = 60 * 60 * 1000
  return Date.now() - updatedAt.getTime() > oneHourMs
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback
  
  try {
    return JSON.parse(json)
  } catch (error) {
    console.error('[JSON] Parse error:', error)
    return fallback
  }
}

/**
 * Log low-confidence classification for review
 */
export function logLowConfidenceClassification(
  phone: string,
  message: string,
  classification: { action: string; confidence: number; reasoning?: string }
): void {
  if (classification.confidence < 0.7) {
    console.warn(`[LowConfidence] Phone: ${phone}, Message: "${message}", Action: ${classification.action}, Confidence: ${classification.confidence}, Reasoning: ${classification.reasoning || 'none'}`)
  }
}

 * Error Handling & Retry Utilities
 * Provides retry logic and error recovery mechanisms
 */

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt)
        console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError!
}

/**
 * Check if classification confidence is too low
 */
export function isAmbiguousClassification(confidence: number): boolean {
  return confidence < 0.7
}

/**
 * Handle ambiguous classification by asking clarifying question
 */
export function getAmbiguityClarification(
  action: string,
  confidence: number,
  context: string
): string {
  if (confidence < 0.5) {
    return "not sure what you mean. could you rephrase that?"
  }
  
  if (action === 'draft_write') {
    return "do you want to create an announcement or poll?"
  }
  
  if (action === 'content_query') {
    return "what specifically are you asking about?"
  }
  
  return "hmm, not sure i got that. can you be more specific?"
}

/**
 * Clean up stale data (should be run periodically)
 */
export async function cleanupStaleData(): Promise<void> {
  const draftRepo = await import('@/lib/repositories/draftRepository')
  const convRepo = await import('@/lib/repositories/conversationRepository')
  
  try {
    // Clear drafts older than 24 hours
    const clearedDrafts = await draftRepo.clearStaleDrafts()
    console.log(`[Cleanup] Cleared ${clearedDrafts} stale drafts`)
    
    // Clear conversation states older than 1 hour
    const clearedStates = await convRepo.clearStaleStates()
    console.log(`[Cleanup] Cleared ${clearedStates} stale conversation states`)
  } catch (error) {
    console.error('[Cleanup] Error during cleanup:', error)
  }
}

/**
 * Detect if draft is stale (> 24 hours)
 */
export function isDraftStale(createdAt: number): boolean {
  const oneDayMs = 24 * 60 * 60 * 1000
  return Date.now() - createdAt > oneDayMs
}

/**
 * Detect if conversation state is stale (> 1 hour)
 */
export function isStateStale(updatedAt: Date): boolean {
  const oneHourMs = 60 * 60 * 1000
  return Date.now() - updatedAt.getTime() > oneHourMs
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback
  
  try {
    return JSON.parse(json)
  } catch (error) {
    console.error('[JSON] Parse error:', error)
    return fallback
  }
}

/**
 * Log low-confidence classification for review
 */
export function logLowConfidenceClassification(
  phone: string,
  message: string,
  classification: { action: string; confidence: number; reasoning?: string }
): void {
  if (classification.confidence < 0.7) {
    console.warn(`[LowConfidence] Phone: ${phone}, Message: "${message}", Action: ${classification.action}, Confidence: ${classification.confidence}, Reasoning: ${classification.reasoning || 'none'}`)
  }
}

 * Error Handling & Retry Utilities
 * Provides retry logic and error recovery mechanisms
 */

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt)
        console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError!
}

/**
 * Check if classification confidence is too low
 */
export function isAmbiguousClassification(confidence: number): boolean {
  return confidence < 0.7
}

/**
 * Handle ambiguous classification by asking clarifying question
 */
export function getAmbiguityClarification(
  action: string,
  confidence: number,
  context: string
): string {
  if (confidence < 0.5) {
    return "not sure what you mean. could you rephrase that?"
  }
  
  if (action === 'draft_write') {
    return "do you want to create an announcement or poll?"
  }
  
  if (action === 'content_query') {
    return "what specifically are you asking about?"
  }
  
  return "hmm, not sure i got that. can you be more specific?"
}

/**
 * Clean up stale data (should be run periodically)
 */
export async function cleanupStaleData(): Promise<void> {
  const draftRepo = await import('@/lib/repositories/draftRepository')
  const convRepo = await import('@/lib/repositories/conversationRepository')
  
  try {
    // Clear drafts older than 24 hours
    const clearedDrafts = await draftRepo.clearStaleDrafts()
    console.log(`[Cleanup] Cleared ${clearedDrafts} stale drafts`)
    
    // Clear conversation states older than 1 hour
    const clearedStates = await convRepo.clearStaleStates()
    console.log(`[Cleanup] Cleared ${clearedStates} stale conversation states`)
  } catch (error) {
    console.error('[Cleanup] Error during cleanup:', error)
  }
}

/**
 * Detect if draft is stale (> 24 hours)
 */
export function isDraftStale(createdAt: number): boolean {
  const oneDayMs = 24 * 60 * 60 * 1000
  return Date.now() - createdAt > oneDayMs
}

/**
 * Detect if conversation state is stale (> 1 hour)
 */
export function isStateStale(updatedAt: Date): boolean {
  const oneHourMs = 60 * 60 * 1000
  return Date.now() - updatedAt.getTime() > oneHourMs
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback
  
  try {
    return JSON.parse(json)
  } catch (error) {
    console.error('[JSON] Parse error:', error)
    return fallback
  }
}

/**
 * Log low-confidence classification for review
 */
export function logLowConfidenceClassification(
  phone: string,
  message: string,
  classification: { action: string; confidence: number; reasoning?: string }
): void {
  if (classification.confidence < 0.7) {
    console.warn(`[LowConfidence] Phone: ${phone}, Message: "${message}", Action: ${classification.action}, Confidence: ${classification.confidence}, Reasoning: ${classification.reasoning || 'none'}`)
  }
}

 * Error Handling & Retry Utilities
 * Provides retry logic and error recovery mechanisms
 */

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt)
        console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError!
}

/**
 * Check if classification confidence is too low
 */
export function isAmbiguousClassification(confidence: number): boolean {
  return confidence < 0.7
}

/**
 * Handle ambiguous classification by asking clarifying question
 */
export function getAmbiguityClarification(
  action: string,
  confidence: number,
  context: string
): string {
  if (confidence < 0.5) {
    return "not sure what you mean. could you rephrase that?"
  }
  
  if (action === 'draft_write') {
    return "do you want to create an announcement or poll?"
  }
  
  if (action === 'content_query') {
    return "what specifically are you asking about?"
  }
  
  return "hmm, not sure i got that. can you be more specific?"
}

/**
 * Clean up stale data (should be run periodically)
 */
export async function cleanupStaleData(): Promise<void> {
  const draftRepo = await import('@/lib/repositories/draftRepository')
  const convRepo = await import('@/lib/repositories/conversationRepository')
  
  try {
    // Clear drafts older than 24 hours
    const clearedDrafts = await draftRepo.clearStaleDrafts()
    console.log(`[Cleanup] Cleared ${clearedDrafts} stale drafts`)
    
    // Clear conversation states older than 1 hour
    const clearedStates = await convRepo.clearStaleStates()
    console.log(`[Cleanup] Cleared ${clearedStates} stale conversation states`)
  } catch (error) {
    console.error('[Cleanup] Error during cleanup:', error)
  }
}

/**
 * Detect if draft is stale (> 24 hours)
 */
export function isDraftStale(createdAt: number): boolean {
  const oneDayMs = 24 * 60 * 60 * 1000
  return Date.now() - createdAt > oneDayMs
}

/**
 * Detect if conversation state is stale (> 1 hour)
 */
export function isStateStale(updatedAt: Date): boolean {
  const oneHourMs = 60 * 60 * 1000
  return Date.now() - updatedAt.getTime() > oneHourMs
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback
  
  try {
    return JSON.parse(json)
  } catch (error) {
    console.error('[JSON] Parse error:', error)
    return fallback
  }
}

/**
 * Log low-confidence classification for review
 */
export function logLowConfidenceClassification(
  phone: string,
  message: string,
  classification: { action: string; confidence: number; reasoning?: string }
): void {
  if (classification.confidence < 0.7) {
    console.warn(`[LowConfidence] Phone: ${phone}, Message: "${message}", Action: ${classification.action}, Confidence: ${classification.confidence}, Reasoning: ${classification.reasoning || 'none'}`)
  }
}

 * Error Handling & Retry Utilities
 * Provides retry logic and error recovery mechanisms
 */

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt)
        console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError!
}

/**
 * Check if classification confidence is too low
 */
export function isAmbiguousClassification(confidence: number): boolean {
  return confidence < 0.7
}

/**
 * Handle ambiguous classification by asking clarifying question
 */
export function getAmbiguityClarification(
  action: string,
  confidence: number,
  context: string
): string {
  if (confidence < 0.5) {
    return "not sure what you mean. could you rephrase that?"
  }
  
  if (action === 'draft_write') {
    return "do you want to create an announcement or poll?"
  }
  
  if (action === 'content_query') {
    return "what specifically are you asking about?"
  }
  
  return "hmm, not sure i got that. can you be more specific?"
}

/**
 * Clean up stale data (should be run periodically)
 */
export async function cleanupStaleData(): Promise<void> {
  const draftRepo = await import('@/lib/repositories/draftRepository')
  const convRepo = await import('@/lib/repositories/conversationRepository')
  
  try {
    // Clear drafts older than 24 hours
    const clearedDrafts = await draftRepo.clearStaleDrafts()
    console.log(`[Cleanup] Cleared ${clearedDrafts} stale drafts`)
    
    // Clear conversation states older than 1 hour
    const clearedStates = await convRepo.clearStaleStates()
    console.log(`[Cleanup] Cleared ${clearedStates} stale conversation states`)
  } catch (error) {
    console.error('[Cleanup] Error during cleanup:', error)
  }
}

/**
 * Detect if draft is stale (> 24 hours)
 */
export function isDraftStale(createdAt: number): boolean {
  const oneDayMs = 24 * 60 * 60 * 1000
  return Date.now() - createdAt > oneDayMs
}

/**
 * Detect if conversation state is stale (> 1 hour)
 */
export function isStateStale(updatedAt: Date): boolean {
  const oneHourMs = 60 * 60 * 1000
  return Date.now() - updatedAt.getTime() > oneHourMs
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback
  
  try {
    return JSON.parse(json)
  } catch (error) {
    console.error('[JSON] Parse error:', error)
    return fallback
  }
}

/**
 * Log low-confidence classification for review
 */
export function logLowConfidenceClassification(
  phone: string,
  message: string,
  classification: { action: string; confidence: number; reasoning?: string }
): void {
  if (classification.confidence < 0.7) {
    console.warn(`[LowConfidence] Phone: ${phone}, Message: "${message}", Action: ${classification.action}, Confidence: ${classification.confidence}, Reasoning: ${classification.reasoning || 'none'}`)
  }
}



