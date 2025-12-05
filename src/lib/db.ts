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
// UTILITIES (defined early for use in user operations)
// ============================================

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1)
  }
  return digits.slice(-10)
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

// Get the actual field name from Airtable (handles tab characters and variations)
// This function tries to find the field in the record's fields object
function getActualFieldName(recordFields: Record<string, unknown>, baseName: string): string | null {
  // Try exact match first
  if (recordFields[baseName] !== undefined) {
    return baseName
  }
  
  // Try with tab character (common Airtable issue)
  const withTab = `${baseName}\t`
  if (recordFields[withTab] !== undefined) {
    return withTab
  }
  
  // Try variations
  const variations = [
    baseName.replace(/_/g, ' '), // Replace underscore with space
    baseName.toLowerCase(),
    baseName.toUpperCase(),
    baseName.replace(/_/g, ' ') + '\t',
    baseName.toLowerCase() + '\t',
  ]
  
  for (const variation of variations) {
    if (recordFields[variation] !== undefined) {
      return variation
    }
  }
  
  return null
}

// Helper to get field value from record, trying all variations
function getFieldValue(recordFields: Record<string, unknown>, baseName: string): unknown {
  const actualName = getActualFieldName(recordFields, baseName)
  if (actualName) {
    return recordFields[actualName]
  }
  return undefined
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
    const normalizedSearch = normalizePhone(phone)
    
    console.log(`[DB] getUserByPhone: searching for "${phone}" -> normalized: "${normalizedSearch}"`)
    
    // Fetch all records and find by normalized phone (Airtable stores formatted phones)
    const records = await base(tableName)
      .select({})
      .all()
    
    console.log(`[DB] getUserByPhone: checking ${records.length} records...`)
    
    // Log all available field names from first record
    if (records.length > 0) {
      console.log(`[DB] getUserByPhone: available fields:`, Object.keys(records[0].fields))
    }
    
    for (const r of records) {
      // Try multiple possible field names for phone
      const phoneField = r.fields.Phone ?? r.fields.phone ?? r.fields.PHONE ?? r.fields['Phone Number'] ?? r.fields['phone number']
      const rawPhone = extractPhone(phoneField)
      const normalizedRecord = normalizePhone(rawPhone)
      
      console.log(`[DB] getUserByPhone: record ${r.id} -> raw: "${rawPhone}" -> normalized: "${normalizedRecord}" (match: ${normalizedRecord === normalizedSearch})`)
      
      if (normalizedRecord === normalizedSearch) {
        console.log(`[DB] getUserByPhone: FOUND MATCH! Record ${r.id}`)
        
        // Get field values using helper (handles tab characters)
        const pendingPoll = getFieldValue(r.fields, 'Pending_Poll')
        const lastResponse = getFieldValue(r.fields, 'Last_Response')
        const lastNotes = getFieldValue(r.fields, 'Last_Notes')
        const needsName = getFieldValue(r.fields, 'Needs_Name')
        const optedOut = getFieldValue(r.fields, 'Opted_Out')
        
        return {
          id: r.id,
          phone: rawPhone,
          name: r.fields.Name ? String(r.fields.Name) : null,
          needs_name: needsName === true,
          opted_out: optedOut === true,
          pending_poll: pendingPoll ? String(pendingPoll) : null,
          last_response: lastResponse ? String(lastResponse) : null,
          last_notes: lastNotes ? String(lastNotes) : null
        }
      }
    }
    
    console.log(`[DB] getUserByPhone: NO MATCH found for "${normalizedSearch}" after checking ${records.length} records`)
    return null
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
    console.log(`[DB] updateUser: record=${recordId}, table=${tableName}, fields=${JSON.stringify(fields)}`)
    
    // First, try to get the record to see what fields actually exist
    let availableFields: string[] = []
    try {
      const record = await base(tableName).find(recordId)
      availableFields = Object.keys(record.fields)
      console.log(`[DB] updateUser: Available fields in record:`, availableFields)
    } catch (fetchError) {
      console.log(`[DB] updateUser: Could not fetch record to check fields`)
    }
    
    // Try the update with normal field names first (user fixed the tab issue)
    try {
      console.log(`[DB] updateUser: Attempting update with fields:`, Object.keys(fields))
      const result = await base(tableName).update(recordId, fields as Airtable.FieldSet)
      console.log(`[DB] updateUser: SUCCESS - updated record ${result.id}`)
      console.log(`[DB] updateUser: Updated fields in result:`, Object.keys(result.fields))
      return true
    } catch (updateError: unknown) {
      const err = updateError as { message?: string; error?: string; statusCode?: number }
      
      // If it's a field name error, try variations
      if (err.error === 'UNKNOWN_FIELD_NAME' || err.message?.includes('Unknown field name')) {
        console.error(`[DB] updateUser: Field name error detected`)
        console.error(`[DB] updateUser: Attempted fields:`, Object.keys(fields))
        console.error(`[DB] updateUser: Available fields in this record:`, availableFields)
        
        // Try field name variations for common fields (normal names first, tab versions as fallback)
        const fieldVariations: Record<string, string[]> = {
          'Pending_Poll': ['Pending_Poll', 'Pending_Poll\t', 'pending_poll', 'Pending Poll', 'pending poll', 'PendingPoll'],
          'Last_Response': ['Last_Response', 'last_response', 'Last Response', 'last response', 'LastResponse'],
          'Last_Notes': ['Last_Notes', 'Last_Notes\t', 'last_notes', 'Last Notes', 'last notes', 'LastNotes'],
          'Needs_Name': ['Needs_Name', 'needs_name', 'Needs Name', 'needs name', 'NeedsName'],
          'Opted_Out': ['Opted_Out', 'Opted_Out\t', 'opted_out', 'Opted Out', 'opted out', 'OptedOut']
        }
        
        const adjustedFields: Record<string, unknown> = {}
        let foundMatch = false
        
        for (const [originalField, value] of Object.entries(fields)) {
          // First check if field exists as-is in availableFields
          if (availableFields.includes(originalField)) {
            adjustedFields[originalField] = value
            foundMatch = true
          } else {
            // Try variations (normal names first, tab versions as fallback)
            const variations = fieldVariations[originalField] || [originalField]
            let matched = false
            for (const variation of variations) {
              if (availableFields.includes(variation)) {
                console.log(`[DB] updateUser: Using field variation "${variation}" instead of "${originalField}"`)
                adjustedFields[variation] = value
                matched = true
                foundMatch = true
                break
              }
            }
            if (!matched) {
              // Field not in availableFields - this can happen if the field is empty
              // Still try the original field name - Airtable may accept it even if not in availableFields
              // This is especially important when clearing fields (empty string or null)
              const isClearingField = value === null || value === '' || (typeof value === 'string' && value.trim() === '')
              if (isClearingField) {
                console.log(`[DB] updateUser: Field "${originalField}" not in availableFields (likely empty), but trying to clear it - using original name`)
              } else {
                console.error(`[DB] updateUser: Could not find field "${originalField}" or any variations in available fields`)
              }
              adjustedFields[originalField] = value
            }
          }
        }
        
        // Try the update with adjusted fields (even if some fields weren't in availableFields)
        if (Object.keys(adjustedFields).length > 0) {
          try {
            const result = await base(tableName).update(recordId, adjustedFields as Airtable.FieldSet)
            console.log(`[DB] updateUser: SUCCESS with field variations - updated record ${result.id}`)
            return true
          } catch (retryError) {
            console.error(`[DB] updateUser: Still failed after trying field variations`)
          }
        }
      }
      
      // If we get here, the update failed
      console.error(`[DB] updateUser: FAILED - record=${recordId}`)
      console.error(`[DB] updateUser: error message:`, err.message || err.error || String(updateError))
      console.error(`[DB] updateUser: status code:`, err.statusCode)
      console.error(`[DB] updateUser: full error:`, JSON.stringify(updateError))
      if (availableFields.length > 0) {
        console.error(`[DB] updateUser: Available fields were:`, availableFields)
      }
      return false
    }
  } catch (error: unknown) {
    const err = error as { message?: string; error?: string; statusCode?: number }
    console.error(`[DB] updateUser: FAILED - record=${recordId}`)
    console.error(`[DB] updateUser: error message:`, err.message || err.error || String(error))
    console.error(`[DB] updateUser: status code:`, err.statusCode)
    console.error(`[DB] updateUser: full error:`, JSON.stringify(error))
    return false
  }
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
      
      // Get field values using helper (handles tab characters)
      const pendingPoll = getFieldValue(r.fields, 'Pending_Poll')
      const lastResponse = getFieldValue(r.fields, 'Last_Response')
      const lastNotes = getFieldValue(r.fields, 'Last_Notes')
      const needsName = getFieldValue(r.fields, 'Needs_Name')
      const optedOut = getFieldValue(r.fields, 'Opted_Out')
      
      console.log(`[DB] Record ${r.id}: Phone="${phone}", OptedOut=${optedOut === true}, Name="${r.fields.Name}"`)
      
      return {
        id: r.id,
        phone,
        name: r.fields.Name ? String(r.fields.Name) : null,
        needs_name: needsName === true,
        opted_out: optedOut === true,
        pending_poll: pendingPoll ? String(pendingPoll) : null,
        last_response: lastResponse ? String(lastResponse) : null,
        last_notes: lastNotes ? String(lastNotes) : null
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

export function toE164(phone: string): string {
  const normalized = normalizePhone(phone)
  return `+1${normalized}`
}

export function isAdmin(phone: string): boolean {
  const admins = process.env.ADMIN_PHONE_NUMBERS || ''
  const adminList = admins.split(',').map(p => normalizePhone(p.trim())).filter(Boolean)
  return adminList.includes(normalizePhone(phone))
}

// Verify that all required fields exist in Airtable
export async function verifyAirtableFields(): Promise<{ success: boolean; missingFields: string[] }> {
  try {
    const tableName = getTableName()
    const apiKey = process.env.AIRTABLE_API_KEY
    const baseId = process.env.AIRTABLE_BASE_ID
    
    if (!apiKey || !baseId) {
      console.error('[DB] verifyAirtableFields: Missing API credentials')
      return { success: false, missingFields: [] }
    }
    
    // Fetch table schema using Airtable Metadata API to get ALL fields (even empty ones)
    let allFieldNames: string[] = []
    try {
      const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (response.ok) {
        const meta = await response.json()
        const table = meta.tables?.find((t: any) => t.name === tableName)
        if (table && table.fields) {
          allFieldNames = table.fields.map((f: any) => f.name)
          console.log('[DB] verifyAirtableFields: All fields from schema:', allFieldNames)
        } else {
          console.error(`[DB] verifyAirtableFields: Table "${tableName}" not found in schema`)
          // Fallback: try to get fields from records
          const base = getBase()
          const records = await base(tableName).select({ maxRecords: 1 }).all()
          if (records.length > 0) {
            allFieldNames = Object.keys(records[0].fields)
            console.log('[DB] verifyAirtableFields: Using fields from records (fallback):', allFieldNames)
          }
        }
      } else {
        console.error(`[DB] verifyAirtableFields: Schema API returned ${response.status}`)
        // Fallback: try to get fields from records
        const base = getBase()
        const records = await base(tableName).select({ maxRecords: 1 }).all()
        if (records.length > 0) {
          allFieldNames = Object.keys(records[0].fields)
          console.log('[DB] verifyAirtableFields: Using fields from records (fallback):', allFieldNames)
        }
      }
    } catch (schemaError) {
      console.error('[DB] verifyAirtableFields: Schema fetch failed, using record fields:', schemaError)
      // Fallback: try to get fields from records
      const base = getBase()
      const records = await base(tableName).select({ maxRecords: 1 }).all()
      if (records.length > 0) {
        allFieldNames = Object.keys(records[0].fields)
        console.log('[DB] verifyAirtableFields: Using fields from records (fallback):', allFieldNames)
      }
    }
    
    const requiredFields = ['Phone', 'Name', 'Needs_Name', 'Opted_Out', 'Pending_Poll', 'Last_Response', 'Last_Notes']
    const missingFields: string[] = []
    
    // Check each required field (try normal name and tab version)
    for (const field of requiredFields) {
      const hasNormal = allFieldNames.includes(field)
      const hasTab = allFieldNames.includes(`${field}\t`)
      
      if (!hasNormal && !hasTab) {
        missingFields.push(field)
      }
    }
    
    if (missingFields.length > 0) {
      console.error('[DB] verifyAirtableFields: Missing fields:', missingFields)
      console.error('[DB] verifyAirtableFields: Please add these fields to your Airtable table')
      return { success: false, missingFields }
    }
    
    console.log('[DB] verifyAirtableFields: All required fields exist ✓')
    return { success: true, missingFields: [] }
  } catch (error) {
    console.error('[DB] verifyAirtableFields error:', error)
    return { success: false, missingFields: [] }
  }
}
