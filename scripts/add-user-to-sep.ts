/**
 * Script to add a specific phone number to the SEP workspace
 * Run with: npx tsx scripts/add-user-to-sep.ts <phone-number>
 * Example: npx tsx scripts/add-user-to-sep.ts 3853687238
 */

import { getPrisma } from '../src/lib/prisma'
import { normalizePhone } from '../src/lib/db'

const phoneNumber = process.argv[2]

if (!phoneNumber) {
  console.error('Usage: npx tsx scripts/add-user-to-sep.ts <phone-number>')
  console.error('Example: npx tsx scripts/add-user-to-sep.ts 3853687238')
  process.exit(1)
}

async function main() {
  const prisma = await getPrisma()

  // Find SEP space
  const sepSpace = await prisma.space.findUnique({
    where: { slug: 'sep' }
  })

  if (!sepSpace) {
    console.error('SEP space not found. Please create it first or run add-sep-members.ts')
    process.exit(1)
  }

  console.log(`Found SEP space: ${sepSpace.name} (${sepSpace.id})`)

  // Normalize phone number
  const normalizedPhone = normalizePhone(phoneNumber)
  console.log(`Normalized phone: ${normalizedPhone}`)

  // Get or create user
  let user = await prisma.user.findUnique({
    where: { phoneNumber: normalizedPhone }
  })

  if (!user) {
    user = await prisma.user.create({
      data: { phoneNumber: normalizedPhone }
    })
    console.log(`Created user: ${user.id}`)
  } else {
    console.log(`Found existing user: ${user.id}`)
  }

  // Check if already a member
  const existing = await prisma.spaceMember.findUnique({
    where: {
      spaceId_userId: {
        spaceId: sepSpace.id,
        userId: user.id
      }
    }
  })

  if (existing) {
    console.log(`User ${normalizedPhone} is already a member of SEP space`)
    process.exit(0)
  }

  // Add as member
  await prisma.spaceMember.create({
    data: {
      spaceId: sepSpace.id,
      userId: user.id,
      role: 'member'
    }
  })

  console.log(`✅ Successfully added ${normalizedPhone} to SEP space`)
}

main()
  .catch(console.error)
  .finally(() => process.exit(0))
