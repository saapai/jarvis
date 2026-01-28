/**
 * Script to remove a phone number from the SEP workspace
 * Run with: npx tsx scripts/remove-phone-from-sep.ts <phone-number>
 * Example: npx tsx scripts/remove-phone-from-sep.ts 3853687238
 */

import { getPrisma } from '../src/lib/prisma'
import { normalizePhone } from '../src/lib/db'

const phoneNumber = process.argv[2]

if (!phoneNumber) {
  console.error('Usage: npx tsx scripts/remove-phone-from-sep.ts <phone-number>')
  console.error('Example: npx tsx scripts/remove-phone-from-sep.ts 3853687238')
  process.exit(1)
}

async function main() {
  const prisma = await getPrisma()

  // Find SEP space
  const sepSpace = await prisma.space.findUnique({
    where: { slug: 'sep' }
  })

  if (!sepSpace) {
    console.error('SEP space not found.')
    process.exit(1)
  }

  console.log(`Found SEP space: ${sepSpace.name} (${sepSpace.id})`)

  // Normalize phone number
  const normalizedPhone = normalizePhone(phoneNumber)
  console.log(`Normalized phone: ${normalizedPhone}`)

  // Find user
  const user = await prisma.user.findUnique({
    where: { phoneNumber: normalizedPhone }
  })

  if (!user) {
    console.log(`User ${normalizedPhone} not found`)
    process.exit(0)
  }

  // Find membership
  const membership = await prisma.spaceMember.findUnique({
    where: {
      spaceId_userId: {
        spaceId: sepSpace.id,
        userId: user.id
      }
    }
  })

  if (!membership) {
    console.log(`User ${normalizedPhone} is not a member of SEP space`)
    process.exit(0)
  }

  // Remove membership
  await prisma.spaceMember.delete({
    where: { id: membership.id }
  })

  console.log(`✅ Successfully removed ${normalizedPhone} from SEP space`)
}

main()
  .catch(console.error)
  .finally(() => process.exit(0))
