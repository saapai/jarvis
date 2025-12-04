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
    const base = getBase()
    const tableName = getTableName()
    // Note: Don't set checkbox to false, just omit it (Airtable quirk)
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
    await base(tableName).update(recordId, fields as Airtable.FieldSet)
    return true
  } catch (error) {
    console.error('updateUser error:', error)
    return false
  }
}

export async function getOptedInUsers(): Promise<User[]> {
  try {
    const base = getBase()
    const tableName = getTableName()
    const records = await base(tableName)
      .select({
        filterByFormula: `OR({Opted_Out} = FALSE(), {Opted_Out} = BLANK())`
      })
      .all()
    
    return records.map(r => ({
      id: r.id,
      phone: String(r.fields.Phone || ''),
      name: r.fields.Name ? String(r.fields.Name) : null,
      needs_name: r.fields.Needs_Name === true,
      opted_out: false,
      pending_poll: r.fields.Pending_Poll ? String(r.fields.Pending_Poll) : null,
      last_response: r.fields.Last_Response ? String(r.fields.Last_Response) : null,
      last_notes: r.fields.Last_Notes ? String(r.fields.Last_Notes) : null
    }))
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
