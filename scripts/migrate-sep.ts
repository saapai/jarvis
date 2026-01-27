/**
 * SEP Space Migration Script
 *
 * This script migrates the existing Jarvis setup to the multi-space model:
 * 1. Creates the SEP space with Airtable config
 * 2. Imports existing members from Airtable to SpaceMember table
 * 3. Updates existing data (messages, drafts, polls, events) with spaceId
 *
 * Run with: npx tsx scripts/migrate-sep.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Admin phone numbers (comma-separated in env)
const ADMIN_PHONES = (process.env.ADMIN_PHONE_NUMBERS || '').split(',').map(p => normalizePhone(p.trim())).filter(Boolean)

function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1)
  }
  return digits.slice(-10)
}

async function migrateToSEP() {
  console.log('Starting SEP space migration...\n')

  // 1. Check if SEP space already exists
  let sepSpace = await prisma.space.findUnique({
    where: { joinCode: 'SEP' }
  })

  if (sepSpace) {
    console.log(`SEP space already exists: ${sepSpace.id}`)
  } else {
    // Create owner user first (use first admin phone)
    const ownerPhone = ADMIN_PHONES[0]
    if (!ownerPhone) {
      console.error('ERROR: No ADMIN_PHONE_NUMBERS configured. Set this env var first.')
      process.exit(1)
    }

    let owner = await prisma.user.findUnique({
      where: { phoneNumber: ownerPhone }
    })

    if (!owner) {
      owner = await prisma.user.create({
        data: {
          phoneNumber: ownerPhone,
          name: 'Admin'
        }
      })
      console.log(`Created owner user: ${owner.id}`)
    }

    // Create SEP space
    sepSpace = await prisma.space.create({
      data: {
        name: 'SEP',
        slug: 'sep',
        joinCode: 'SEP',
        ownerId: owner.id,
        airtableBaseId: process.env.AIRTABLE_BASE_ID || null,
        airtableTableName: process.env.AIRTABLE_TABLE_NAME || 'Enclave'
      }
    })
    console.log(`Created SEP space: ${sepSpace.id}`)

    // Add owner as member
    await prisma.spaceMember.create({
      data: {
        spaceId: sepSpace.id,
        userId: owner.id,
        role: 'owner',
        name: owner.name
      }
    })
    console.log(`Added owner as member`)
  }

  const spaceId = sepSpace.id

  // 2. Import members from Airtable (if AIRTABLE env vars are set)
  if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
    console.log('\nImporting members from Airtable...')

    try {
      // Dynamic import of Airtable
      const Airtable = (await import('airtable')).default
      Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY })
      const base = Airtable.base(process.env.AIRTABLE_BASE_ID)
      const tableName = process.env.AIRTABLE_TABLE_NAME || 'Enclave'

      const records = await base(tableName).select({}).all()
      console.log(`Found ${records.length} records in Airtable`)

      let imported = 0
      let skipped = 0

      for (const record of records) {
        const rawPhone = record.fields.Phone as string || ''
        const phone = normalizePhone(rawPhone)

        if (!phone || phone.length < 10) {
          skipped++
          continue
        }

        const name = record.fields.Name as string || null
        const optedOut = record.fields.Opted_Out === true

        // Get or create user
        let user = await prisma.user.findUnique({
          where: { phoneNumber: phone }
        })

        if (!user) {
          user = await prisma.user.create({
            data: {
              phoneNumber: phone,
              name
            }
          })
        } else if (name && !user.name) {
          await prisma.user.update({
            where: { id: user.id },
            data: { name }
          })
        }

        // Check if already a member
        const existing = await prisma.spaceMember.findUnique({
          where: {
            spaceId_userId: {
              spaceId,
              userId: user.id
            }
          }
        })

        if (!existing) {
          const role = ADMIN_PHONES.includes(phone) ? 'admin' : 'member'
          await prisma.spaceMember.create({
            data: {
              spaceId,
              userId: user.id,
              role,
              name,
              optedOut
            }
          })
          imported++
        } else {
          skipped++
        }
      }

      console.log(`Imported ${imported} members, skipped ${skipped}`)
    } catch (err) {
      console.error('Airtable import failed:', err)
    }
  } else {
    console.log('\nSkipping Airtable import (AIRTABLE env vars not set)')
  }

  // 3. Update existing data with spaceId
  console.log('\nUpdating existing data with spaceId...')

  // Update messages
  const messageResult = await prisma.message.updateMany({
    where: { spaceId: null },
    data: { spaceId }
  })
  console.log(`Updated ${messageResult.count} messages`)

  // Update conversation states
  const convResult = await prisma.conversationState.updateMany({
    where: { spaceId: null },
    data: { spaceId, activeSpaceId: spaceId }
  })
  console.log(`Updated ${convResult.count} conversation states`)

  // Update drafts
  const draftResult = await prisma.announcementDraft.updateMany({
    where: { spaceId: null },
    data: { spaceId }
  })
  console.log(`Updated ${draftResult.count} drafts`)

  // Update polls
  const pollResult = await prisma.pollMeta.updateMany({
    where: { spaceId: null },
    data: { spaceId }
  })
  console.log(`Updated ${pollResult.count} polls`)

  // Update events
  const eventResult = await prisma.event.updateMany({
    where: { spaceId: null },
    data: { spaceId }
  })
  console.log(`Updated ${eventResult.count} events`)

  // Update uploads
  const uploadResult = await prisma.upload.updateMany({
    where: { spaceId: null },
    data: { spaceId }
  })
  console.log(`Updated ${uploadResult.count} uploads`)

  // Update facts
  const factResult = await prisma.fact.updateMany({
    where: { spaceId: null },
    data: { spaceId }
  })
  console.log(`Updated ${factResult.count} facts`)

  // Update scheduled announcements
  const schedResult = await prisma.scheduledAnnouncement.updateMany({
    where: { spaceId: null },
    data: { spaceId }
  })
  console.log(`Updated ${schedResult.count} scheduled announcements`)

  // Update slack syncs
  const slackResult = await prisma.slackSync.updateMany({
    where: { spaceId: null },
    data: { spaceId }
  })
  console.log(`Updated ${slackResult.count} slack syncs`)

  console.log('\n✓ Migration complete!')
  console.log(`\nSEP space details:`)
  console.log(`  ID: ${spaceId}`)
  console.log(`  Join code: SEP`)
  console.log(`  Slug: sep`)
  console.log(`  Airtable Base: ${sepSpace.airtableBaseId || 'None'}`)

  // Show member count
  const memberCount = await prisma.spaceMember.count({
    where: { spaceId }
  })
  console.log(`  Members: ${memberCount}`)
}

async function main() {
  try {
    await migrateToSEP()
  } catch (err) {
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
