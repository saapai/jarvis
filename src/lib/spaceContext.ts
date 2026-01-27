/**
 * Space Context Utilities
 * Helpers for working with space-scoped data
 */

import { getPrisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/db'

/**
 * Get the active space ID for a phone number
 * This is used by SMS routing to determine which space to use
 */
export async function getActiveSpaceId(phoneNumber: string): Promise<string | null> {
  const prisma = await getPrisma()
  const normalizedPhone = normalizePhone(phoneNumber)

  // Get the conversation state which tracks active space
  const state = await prisma.conversationState.findFirst({
    where: {
      phoneNumber: normalizedPhone,
      activeSpaceId: { not: null }
    },
    orderBy: { updatedAt: 'desc' }
  })

  if (state?.activeSpaceId) {
    return state.activeSpaceId
  }

  // If no active space set, check if user is only in one space
  const user = await prisma.user.findUnique({
    where: { phoneNumber: normalizedPhone },
    include: {
      memberships: {
        where: { optedOut: false },
        take: 2 // Only need to know if more than 1
      }
    }
  })

  if (user?.memberships.length === 1) {
    // User is in exactly one space, use that
    return user.memberships[0].spaceId
  }

  return null
}

/**
 * Set the active space for a phone number
 */
export async function setActiveSpaceId(phoneNumber: string, spaceId: string): Promise<void> {
  const prisma = await getPrisma()
  const normalizedPhone = normalizePhone(phoneNumber)

  await prisma.conversationState.upsert({
    where: {
      phoneNumber_spaceId: {
        phoneNumber: normalizedPhone,
        spaceId: spaceId
      }
    },
    update: {
      activeSpaceId: spaceId,
      updatedAt: new Date()
    },
    create: {
      phoneNumber: normalizedPhone,
      spaceId: spaceId,
      activeSpaceId: spaceId,
      updatedAt: new Date()
    }
  })
}

/**
 * Get all spaces a user is a member of
 */
export async function getUserSpacesByPhone(phoneNumber: string) {
  const prisma = await getPrisma()
  const normalizedPhone = normalizePhone(phoneNumber)

  const user = await prisma.user.findUnique({
    where: { phoneNumber: normalizedPhone },
    include: {
      memberships: {
        where: { optedOut: false },
        include: {
          space: true
        }
      }
    }
  })

  if (!user) return []

  return user.memberships.map(m => ({
    id: m.space.id,
    name: m.space.name,
    slug: m.space.slug,
    joinCode: m.space.joinCode,
    role: m.role
  }))
}

/**
 * Find space by join code
 */
export async function findSpaceByJoinCode(joinCode: string) {
  const prisma = await getPrisma()
  const code = joinCode.toUpperCase().trim()

  return prisma.space.findUnique({
    where: { joinCode: code }
  })
}

/**
 * Add user to a space
 */
export async function addUserToSpace(phoneNumber: string, spaceId: string, name?: string) {
  const prisma = await getPrisma()
  const normalizedPhone = normalizePhone(phoneNumber)

  // Get or create user
  let user = await prisma.user.findUnique({
    where: { phoneNumber: normalizedPhone }
  })

  if (!user) {
    user = await prisma.user.create({
      data: {
        phoneNumber: normalizedPhone,
        name: name || null
      }
    })
  }

  // Check if already a member
  const existingMembership = await prisma.spaceMember.findUnique({
    where: {
      spaceId_userId: {
        spaceId,
        userId: user.id
      }
    }
  })

  if (existingMembership) {
    // Already a member, just update optedOut if needed
    if (existingMembership.optedOut) {
      await prisma.spaceMember.update({
        where: { id: existingMembership.id },
        data: { optedOut: false }
      })
    }
    return { existing: true, membership: existingMembership }
  }

  // Create new membership
  const membership = await prisma.spaceMember.create({
    data: {
      spaceId,
      userId: user.id,
      role: 'member',
      name: name || null
    }
  })

  return { existing: false, membership }
}

/**
 * Get space member by phone number
 */
export async function getSpaceMember(spaceId: string, phoneNumber: string) {
  const prisma = await getPrisma()
  const normalizedPhone = normalizePhone(phoneNumber)

  const member = await prisma.spaceMember.findFirst({
    where: {
      spaceId,
      user: {
        phoneNumber: normalizedPhone
      },
      optedOut: false
    },
    include: {
      user: true,
      space: true
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
    space: member.space
  }
}

/**
 * Check if user is admin of a space (by phone)
 */
export async function isSpaceAdminByPhone(spaceId: string, phoneNumber: string): Promise<boolean> {
  const member = await getSpaceMember(spaceId, phoneNumber)
  return member?.role === 'owner' || member?.role === 'admin'
}

/**
 * Get all opted-in members of a space
 */
export async function getSpaceMembers(spaceId: string) {
  const prisma = await getPrisma()

  const members = await prisma.spaceMember.findMany({
    where: {
      spaceId,
      optedOut: false
    },
    include: {
      user: true
    }
  })

  return members.map(m => ({
    id: m.id,
    userId: m.userId,
    name: m.name || m.user.name,
    phoneNumber: m.user.phoneNumber,
    role: m.role
  }))
}

/**
 * Set member opt-out status
 */
export async function setMemberOptedOut(spaceId: string, phoneNumber: string, optedOut: boolean): Promise<void> {
  const prisma = await getPrisma()
  const normalizedPhone = normalizePhone(phoneNumber)

  await prisma.spaceMember.updateMany({
    where: {
      spaceId,
      user: {
        phoneNumber: normalizedPhone
      }
    },
    data: { optedOut }
  })
}
