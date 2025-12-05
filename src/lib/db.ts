import Airtable from 'airtable'

let _base: Airtable.Base | null = null

function getBase(): Airtable.Base {
  if (!_base) {
    const apiKey = process.env.AIRTABLE_API_KEY
    const baseId = process.env.AIRTABLE_BASE_ID
    
    if (!apiKey || !baseId) {
      throw new Error('Missing Airtable environment variables')
    }
    
    Airtable.configure({ apiKey })
    _base = Airtable.base(baseId)
  }
  return _base
}

function getTableName(): string {
  return process.env.AIRTABLE_TABLE_NAME || 'Enclave'
}

// ============================================
// USER OPERATIONS
// ============================================

export interface User {
  id: string
  phone: string
  name: string | null
  needs_name: boolean
  opted_out: boolean
  pending_poll: string | null  // Current poll question waiting for response
  last_response: string | null
  last_notes: string | null
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  try {
    const base = getBase()
    const tableName = getTableName()
    const records = await base(tableName)
      .select({
        filterByFormula: `{Phone} = '${phone}'`,
        maxRecords: 1
      })
      .firstPage()
    
    if (records.length === 0) return null
    
    const r = records[0]
    return {
      id: r.id,
      phone: String(r.fields.Phone || ''),
      name: r.fields.Name ? String(r.fields.Name) : null,
      needs_name: r.fields.Needs_Name === true,
      opted_out: r.fields.Opted_Out === true,
      pending_poll: r.fields.Pending_Poll ? String(r.fields.Pending_Poll) : null,
      last_response: r.fields.Last_Response ? String(r.fields.Last_Response) : null,
      last_notes: r.fields.Last_Notes ? String(r.fields.Last_Notes) : null
    }
  } catch (error) {
    console.error('getUserByPhone error:', error)
    return null
  }
}

export async function createUser(phone: string): Promise<User | null> {
  try {
    // First check if user already exists (prevent duplicates)
    const existing = await getUserByPhone(phone)
    if (existing) {
      console.log(`[DB] User ${phone} already exists, returning existing record`)
      return existing
    }
    
    const base = getBase()
    const tableName = getTableName()
    console.log(`[DB] Creating new user: ${phone}`)
    const record = await base(tableName).create({
      Phone: phone,
      Needs_Name: true
    } as Airtable.FieldSet)
    
    return {
      id: record.id,
      phone,
      name: null,
      needs_name: true,
      opted_out: false,
      pending_poll: null,
      last_response: null,
      last_notes: null
    }
  } catch (error) {
    console.error('createUser error:', error)
    return null
  }
}

export async function updateUser(recordId: string, fields: Record<string, unknown>): Promise<boolean> {
  try {
    const base = getBase()
    const tableName = getTableName()
    console.log(`[DB] Updating record ${recordId} with:`, JSON.stringify(fields))
    await base(tableName).update(recordId, fields as Airtable.FieldSet)
    console.log(`[DB] Update successful`)
    return true
  } catch (error) {
    console.error('updateUser error:', error)
    return false
  }
}

// Extract phone from various Airtable field formats
function extractPhone(field: unknown): string {
  if (!field) return ''
  
  // If it's already a string
  if (typeof field === 'string') {
    return field
  }
  
  // If it's an object (some Airtable field types return objects)
  if (typeof field === 'object') {
    const obj = field as Record<string, unknown>
    // Try common properties
    if (obj.text) return String(obj.text)
    if (obj.number) return String(obj.number)
    if (obj.value) return String(obj.value)
    // Fallback: stringify and extract digits
    return JSON.stringify(obj)
  }
  
  // If it's a number
  if (typeof field === 'number') {
    return String(field)
  }
  
  return String(field)
}

export async function getOptedInUsers(): Promise<User[]> {
  try {
    const base = getBase()
    const tableName = getTableName()
    
    // Get ALL records - filter in code to avoid field name issues
    const records = await base(tableName)
      .select({})
      .all()
    
    console.log(`[DB] getOptedInUsers: found ${records.length} total records`)
    console.log(`[DB] Available fields in first record:`, records[0] ? Object.keys(records[0].fields) : 'none')
    
    const users = records.map(r => {
      const rawPhone = r.fields.Phone
      const phone = extractPhone(rawPhone)
      const optedOut = r.fields.Opted_Out === true || r.fields.opted_out === true
      
      console.log(`[DB] Record ${r.id}: Phone="${phone}", OptedOut=${optedOut}, Name="${r.fields.Name}"`)
      
      return {
        id: r.id,
        phone,
        name: r.fields.Name ? String(r.fields.Name) : null,
        needs_name: r.fields.Needs_Name === true || r.fields.needs_name === true,
        opted_out: optedOut,
        pending_poll: r.fields.Pending_Poll ? String(r.fields.Pending_Poll) : (r.fields.pending_poll ? String(r.fields.pending_poll) : null),
        last_response: r.fields.Last_Response ? String(r.fields.Last_Response) : (r.fields.last_response ? String(r.fields.last_response) : null),
        last_notes: r.fields.Last_Notes ? String(r.fields.Last_Notes) : (r.fields.last_notes ? String(r.fields.last_notes) : null)
      }
    })
    
    // Filter out opted-out users in code
    const optedIn = users.filter(u => !u.opted_out)
    
    // Log users with phones for debugging
    const usersWithPhones = optedIn.filter(u => u.phone && normalizePhone(u.phone).length >= 10)
    console.log(`[DB] getOptedInUsers: ${usersWithPhones.length} users have valid phone numbers (of ${optedIn.length} opted-in)`)
    usersWithPhones.forEach(u => console.log(`[DB]   - ${u.name || 'unnamed'}: ${u.phone} -> normalized: ${normalizePhone(u.phone)}`))
    
    return optedIn
  } catch (error) {
    console.error('getOptedInUsers error:', error)
    return []
  }
}

// ============================================
// UTILITIES
// ============================================

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1)
  }
  return digits.slice(-10)
}

export function toE164(phone: string): string {
  const normalized = normalizePhone(phone)
  return `+1${normalized}`
}

export function isAdmin(phone: string): boolean {
  const admins = process.env.ADMIN_PHONE_NUMBERS || ''
  const adminList = admins.split(',').map(p => normalizePhone(p.trim())).filter(Boolean)
  return adminList.includes(normalizePhone(phone))
}
