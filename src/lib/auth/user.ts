/**
 * User management utilities
 * Bridges Supabase Auth with our User table
 */

import { getPrisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/db'
import type { User as SupabaseUser } from '@supabase/supabase-js'

export interface AppUser {
  id: string
  phoneNumber: string
  name: string | null
  createdAt: Date
}

/**
 * Get or create a user in our database from a Supabase auth user
 * The phone number is extracted from the Supabase user's phone field
 */
export async function getOrCreateUser(supabaseUser: SupabaseUser): Promise<AppUser | null> {
  const phone = supabaseUser.phone
  if (!phone) {
    console.error('[Auth] Supabase user has no phone number')
    return null
  }

  const normalizedPhone = normalizePhone(phone)
  const prisma = await getPrisma()

  // Try to find existing user
  let user = await prisma.user.findUnique({
    where: { phoneNumber: normalizedPhone }
  })

  // Create if doesn't exist
  if (!user) {
    user = await prisma.user.create({
      data: {
        phoneNumber: normalizedPhone,
        name: null
      }
    })
    console.log(`[Auth] Created new user: ${user.id} for phone: ${normalizedPhone}`)
  }

  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    createdAt: user.createdAt
  }
}

/**
 * Get user by phone number
 */
export async function getUserByPhone(phone: string): Promise<AppUser | null> {
  const normalizedPhone = normalizePhone(phone)
  const prisma = await getPrisma()

  const user = await prisma.user.findUnique({
    where: { phoneNumber: normalizedPhone }
  })

  if (!user) return null

  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    createdAt: user.createdAt
  }
}

/**
 * Update user name
 */
export async function updateUserName(userId: string, name: string): Promise<AppUser | null> {
  const prisma = await getPrisma()

  const user = await prisma.user.update({
    where: { id: userId },
    data: { name }
  })

  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    createdAt: user.createdAt
  }
}

/**
 * Get user's spaces with membership info
 */
export async function getUserSpaces(userId: string) {
  const prisma = await getPrisma()

  const memberships = await prisma.spaceMember.findMany({
    where: {
      userId,
      optedOut: false
    },
    include: {
      space: {
        include: {
          _count: {
            select: { members: true }
          }
        }
      }
    }
  })

  return memberships.map(m => ({
    id: m.space.id,
    name: m.space.name,
    slug: m.space.slug,
    joinCode: m.space.joinCode,
    role: m.role,
    memberCount: m.space._count.members,
    joinedAt: m.joinedAt
  }))
}

/**
 * Check if user is admin of a space
 */
export async function isSpaceAdmin(userId: string, spaceId: string): Promise<boolean> {
  const prisma = await getPrisma()

  const membership = await prisma.spaceMember.findUnique({
    where: {
      spaceId_userId: { spaceId, userId }
    }
  })

  return membership?.role === 'owner' || membership?.role === 'admin'
}

/**
 * Get space member by phone number
 */
export async function getSpaceMemberByPhone(spaceId: string, phone: string) {
  const normalizedPhone = normalizePhone(phone)
  const prisma = await getPrisma()

  const member = await prisma.spaceMember.findFirst({
    where: {
      spaceId,
      user: {
        phoneNumber: normalizedPhone
      }
    },
    include: {
      user: true
    }
  })

  if (!member) return null

  return {
    id: member.id,
    userId: member.userId,
    spaceId: member.spaceId,
    role: member.role,
    name: member.name || member.user.name,
    phoneNumber: member.user.phoneNumber,
    optedOut: member.optedOut,
    joinedAt: member.joinedAt
  }
}
