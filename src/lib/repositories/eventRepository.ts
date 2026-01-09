/**
 * Event Repository
 * Manages event creation and tracking for reminders
 */

import { getPrisma } from '@/lib/prisma'

export interface Event {
  id: string
  title: string
  description: string | null
  eventDate: Date
  location: string | null
  createdBy: string
  category: string | null
  reminderSent: boolean
  morningReminderSent: boolean
  linkedFactId: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Create a new event
 */
export async function createEvent(params: {
  title: string
  description?: string
  eventDate: Date
  location?: string
  createdBy: string
  category?: string
  linkedFactId?: string
}): Promise<Event> {
  const prisma = await getPrisma()

  const event = await prisma.event.create({
    data: {
      title: params.title,
      description: params.description || null,
      eventDate: params.eventDate,
      location: params.location || null,
      createdBy: params.createdBy,
      category: params.category || null,
      linkedFactId: params.linkedFactId || null
    }
  })

  return event
}

/**
 * Get upcoming events that need morning reminders (9am same day)
 */
export async function getEventsNeedingMorningReminder(): Promise<Event[]> {
  const prisma = await getPrisma()

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const events = await prisma.event.findMany({
    where: {
      eventDate: {
        gte: today,
        lt: tomorrow
      },
      morningReminderSent: false
    },
    orderBy: { eventDate: 'asc' }
  })

  return events
}

/**
 * Get upcoming events that need 2-hour reminders
 */
export async function getEventsNeeding2HourReminder(): Promise<Event[]> {
  const prisma = await getPrisma()

  const now = new Date()
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  const twoHoursThirtyFromNow = new Date(now.getTime() + 2.5 * 60 * 60 * 1000)

  const events = await prisma.event.findMany({
    where: {
      eventDate: {
        gte: twoHoursFromNow,
        lte: twoHoursThirtyFromNow
      },
      reminderSent: false
    },
    orderBy: { eventDate: 'asc' }
  })

  return events
}

/**
 * Mark morning reminder as sent
 */
export async function markMorningReminderSent(eventId: string): Promise<void> {
  const prisma = await getPrisma()
  await prisma.event.update({
    where: { id: eventId },
    data: { morningReminderSent: true }
  })
}

/**
 * Mark 2-hour reminder as sent
 */
export async function mark2HourReminderSent(eventId: string): Promise<void> {
  const prisma = await getPrisma()
  await prisma.event.update({
    where: { id: eventId },
    data: { reminderSent: true }
  })
}

/**
 * Get all upcoming events
 */
export async function getUpcomingEvents(limit: number = 10): Promise<Event[]> {
  const prisma = await getPrisma()

  const now = new Date()

  const events = await prisma.event.findMany({
    where: {
      eventDate: {
        gte: now
      }
    },
    orderBy: { eventDate: 'asc' },
    take: limit
  })

  return events
}

/**
 * Get all past events
 */
export async function getPastEvents(limit: number = 10): Promise<Event[]> {
  const prisma = await getPrisma()

  const now = new Date()

  const events = await prisma.event.findMany({
    where: {
      eventDate: {
        lt: now
      }
    },
    orderBy: { eventDate: 'desc' },
    take: limit
  })

  return events
}

/**
 * Update event details
 */
export async function updateEvent(
  eventId: string,
  updates: {
    title?: string
    description?: string
    eventDate?: Date
    location?: string
    category?: string
  }
): Promise<Event> {
  const prisma = await getPrisma()

  const event = await prisma.event.update({
    where: { id: eventId },
    data: {
      ...updates,
      updatedAt: new Date()
    }
  })

  return event
}

/**
 * Delete an event
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const prisma = await getPrisma()
  await prisma.event.delete({
    where: { id: eventId }
  })
}

