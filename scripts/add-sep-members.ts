/**
 * Script to add phone numbers to the SEP workspace
 * Run with: npx tsx scripts/add-sep-members.ts
 */

import { getPrisma } from '../src/lib/prisma'
import { normalizePhone } from '../src/lib/db'

// Phone numbers in various formats - will be normalized
const SEP_PHONE_NUMBERS = [
  '3853687238', // Saathvik
  '9175288704', // Aryan
  '4259790010', // Abby
  '8588293100', // Kevin
  '3038450766', // Quinn
  '8573964806', // Rahul
  '3105717011', // Ani
  '3235091761', // Johnathan
  '4088051435', // Arushi
  '3105008359', // Lindsey
  '8588374987', // elijah
  '5083175184', // Kit
  '9252971911', // Sharan
  '3108737200', // Huixi
  '4244660408', // layla
  '5102196504', // Beck
  '4086490769', // Joanna
  '8189299990', // Dilnar
  '3105059297', // Barima
  '4438963819', // Allie
  '3232706359', // kera
  '4259791041', // sonali
  '3105971118', // Elise
  '5058199928', // Ming
  '8184398818', // Mark
  '9253369249', // yashas
  '9259008019', // Gary
  '4155359656', // sophie
  '5108993006', // Brandon
  '9132938404', // Ash
  '6573637311', // Sidney
  '3103673514', // Joseph
  '4692741037', // Natalie
  '9734376074', // armaan bassi
  '4086685541', // Edward
  '4698290081', // Mahi
  '4244075337', // Ruhaan
  '9967574792', // Ruhaan
  '6508636891', // Anusha
  '3107808121', // Charlotte
  '4249770401', // (no name)
  '7606930594', // leilani
  '3609314664', // Simon
  '4087636262', // Henry - +1 (408) 763-6262
  '8585275611', // Tyler - +1 (858) 527-5611
  '6505186293', // Sophia - +1 (650) 518-6293
  '3104866781', // Anannya - +1 (310) 486-6781
  '6508899373', // Ani - +1 (650) 889-9373
  '6503461001', // Evan - +1 (650) 346-1001
  '9494669092', // Maddie - +1 (949) 466-9092
  '6577240606', // Darren - +1 (657) 724-0606
  '5596531293', // Matthew - +1 (559) 653-1293
  '6264786106', // Harrison - +1 (626) 478-6106
  '4152718271', // Fiona - (415) 271-8271
  '6196435215', // Franco - (619) 643-5215
]

async function main() {
  const prisma = await getPrisma()

  // Find or create SEP space
  let sepSpace = await prisma.space.findUnique({
    where: { slug: 'sep' }
  })

  if (!sepSpace) {
    // Create SEP space if it doesn't exist
    // First, we need an owner - let's use the first phone number as owner
    const firstPhone = normalizePhone(SEP_PHONE_NUMBERS[0])
    
    // Get or create owner user
    let owner = await prisma.user.findUnique({
      where: { phoneNumber: firstPhone }
    })

    if (!owner) {
      owner = await prisma.user.create({
        data: { phoneNumber: firstPhone }
      })
      console.log(`Created owner user: ${owner.id} for ${firstPhone}`)
    }

    sepSpace = await prisma.space.create({
      data: {
        name: 'Enclave',
        slug: 'sep',
        joinCode: 'SEP',
        ownerId: owner.id,
        airtableBaseId: process.env.AIRTABLE_BASE_ID || undefined,
        airtableTableName: process.env.AIRTABLE_TABLE_NAME || 'Enclave'
      }
    })
    console.log(`Created SEP space: ${sepSpace.id}`)

    // Add owner as member
    await prisma.spaceMember.create({
      data: {
        spaceId: sepSpace.id,
        userId: owner.id,
        role: 'owner'
      }
    })
    console.log(`Added owner as member`)
  } else {
    console.log(`Found existing SEP space: ${sepSpace.id}`)
  }

  // Add all phone numbers as members
  let added = 0
  let skipped = 0
  let errors = 0

  for (const phone of SEP_PHONE_NUMBERS) {
    try {
      const normalizedPhone = normalizePhone(phone)

      // Get or create user
      let user = await prisma.user.findUnique({
        where: { phoneNumber: normalizedPhone }
      })

      if (!user) {
        user = await prisma.user.create({
          data: { phoneNumber: normalizedPhone }
        })
        console.log(`Created user: ${user.id} for ${normalizedPhone}`)
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
        console.log(`User ${normalizedPhone} already a member, skipping`)
        skipped++
        continue
      }

      // Add as member
      await prisma.spaceMember.create({
        data: {
          spaceId: sepSpace.id,
          userId: user.id,
          role: 'member'
        }
      })
      console.log(`Added ${normalizedPhone} as member`)
      added++
    } catch (error) {
      console.error(`Error adding ${phone}:`, error)
      errors++
    }
  }

  console.log(`\nSummary:`)
  console.log(`- Added: ${added}`)
  console.log(`- Skipped (already members): ${skipped}`)
  console.log(`- Errors: ${errors}`)
  console.log(`- Total processed: ${SEP_PHONE_NUMBERS.length}`)
}

main()
  .catch(console.error)
  .finally(() => process.exit(0))
