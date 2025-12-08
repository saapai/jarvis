/**
 * Member Repository
 * Wrapper around Airtable operations for user management
 */

import { getUserByPhone, createUser, updateUser, getOptedInUsers, type User } from '@/lib/db'

/**
 * Get user by phone number
 */
export async function getMember(phone: string): Promise<User | null> {
  return await getUserByPhone(phone)
}

/**
 * Create new member
 */
export async function createMember(phone: string): Promise<User | null> {
  return await createUser(phone)
}

/**
 * Update member fields
 */
export async function updateMember(
  recordId: string,
  fields: Record<string, unknown>
): Promise<boolean> {
  return await updateUser(recordId, fields)
}

/**
 * Get all opted-in members
 */
export async function getOptedInMembers(): Promise<User[]> {
  return await getOptedInUsers()
}

/**
 * Set member as needing name
 */
export async function setNeedsName(
  recordId: string,
  needsName: boolean
): Promise<boolean> {
  return await updateUser(recordId, { Needs_Name: needsName })
}

/**
 * Update member name
 */
export async function updateMemberName(
  recordId: string,
  name: string
): Promise<boolean> {
  return await updateUser(recordId, { 
    Name: name,
    Needs_Name: false
  })
}

/**
 * Set member opt-out status
 */
export async function setOptedOut(
  recordId: string,
  optedOut: boolean
): Promise<boolean> {
  return await updateUser(recordId, { Opted_Out: optedOut })
}

/**
 * Check if phone is admin
 */
export function isAdmin(phone: string): boolean {
  const admins = process.env.ADMIN_PHONE_NUMBERS || ''
  const adminList = admins.split(',').map(p => p.trim()).filter(Boolean)
  
  // Normalize phone for comparison
  const normalizePhone = (p: string) => p.replace(/[^\d]/g, '').slice(-10)
  const normalized = normalizePhone(phone)
  
  return adminList.some(admin => normalizePhone(admin) === normalized)
}
