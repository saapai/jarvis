#!/usr/bin/env node

/**
 * Script to check content and actionable items, and test cron endpoints
 * Usage: node scripts/check-crons.js [port]
 */

const { getPrisma } = require('../src/lib/prisma');

const PORT = process.argv[2] || 3000;
const BASE_URL = `http://localhost:${PORT}`;
const CRON_SECRET = process.env.CRON_SECRET || '';

async function main() {
  console.log('🔍 Checking Content and Actionable Items\n');
  console.log('=' .repeat(80));
  
  try {
    const prisma = await getPrisma();
    
    // Query all Facts
    const facts = await prisma.fact.findMany({
      include: {
        upload: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50, // Limit to recent 50
    });
    
    console.log(`\n📋 FACTS (Content) - ${facts.length} total\n`);
    facts.forEach((fact, idx) => {
      console.log(`[${idx + 1}] ${fact.content.substring(0, 80)}...`);
      console.log(`    ID: ${fact.id}`);
      console.log(`    Category: ${fact.category}${fact.subcategory ? ` / ${fact.subcategory}` : ''}`);
      console.log(`    Date: ${fact.dateStr || fact.timeRef || 'N/A'}`);
      console.log(`    Created: ${fact.createdAt.toISOString()}`);
      console.log(`    Upload: ${fact.upload.name}`);
      console.log('');
    });
    
    // Query all ScheduledAnnouncements (actionable items) with their source facts
    const scheduledAnnouncements = await prisma.scheduledAnnouncement.findMany({
      include: {
        sourceFact: {
          select: {
            id: true,
            content: true,
            category: true,
            subcategory: true,
          },
        },
      },
      orderBy: {
        scheduledFor: 'asc',
      },
    });
    
    console.log(`\n📢 SCHEDULED ANNOUNCEMENTS (Actionable Items) - ${scheduledAnnouncements.length} total\n`);
    scheduledAnnouncements.forEach((announcement, idx) => {
      console.log(`[${idx + 1}] ${announcement.content.substring(0, 80)}...`);
      console.log(`    ID: ${announcement.id}`);
      console.log(`    Scheduled For: ${announcement.scheduledFor.toISOString()}`);
      console.log(`    Sent: ${announcement.sent ? `Yes (${announcement.sentAt?.toISOString()})` : 'No'}`);
      if (announcement.sourceFact) {
        console.log(`    Source Fact: ${announcement.sourceFact.content.substring(0, 60)}...`);
        console.log(`    Source Fact ID: ${announcement.sourceFact.id}`);
      }
      console.log(`    Source Message TS: ${announcement.sourceMessageTs || 'N/A'}`);
      console.log('');
    });
    
    // Group scheduled announcements by source fact
    const announcementsByFact = {};
    scheduledAnnouncements.forEach(announcement => {
      if (announcement.sourceFactId) {
        if (!announcementsByFact[announcement.sourceFactId]) {
          announcementsByFact[announcement.sourceFactId] = [];
        }
        announcementsByFact[announcement.sourceFactId].push(announcement);
      }
    });
    
    console.log(`\n🔗 ACTIONABLE ITEMS PER CONTENT (Fact)\n`);
    const factsWithAnnouncements = facts.filter(f => announcementsByFact[f.id]);
    if (factsWithAnnouncements.length > 0) {
      factsWithAnnouncements.forEach((fact, idx) => {
        console.log(`[${idx + 1}] FACT: ${fact.content.substring(0, 80)}...`);
        console.log(`    Fact ID: ${fact.id}`);
        const announcements = announcementsByFact[fact.id];
        console.log(`    Actionable Items: ${announcements.length}`);
        announcements.forEach((ann, annIdx) => {
          console.log(`      [${annIdx + 1}] Scheduled: ${ann.scheduledFor.toISOString()}`);
          console.log(`          Content: ${ann.content.substring(0, 60)}...`);
          console.log(`          Status: ${ann.sent ? 'Sent' : 'Pending'}`);
        });
        console.log('');
      });
    } else {
      console.log('No facts with scheduled announcements found.\n');
    }
    
    // Query all Events
    const events = await prisma.event.findMany({
      include: {
        linkedFact: {
          select: {
            id: true,
            content: true,
            category: true,
          },
        },
      },
      orderBy: {
        eventDate: 'asc',
      },
    });
    
    console.log(`\n📅 EVENTS - ${events.length} total\n`);
    events.forEach((event, idx) => {
      console.log(`[${idx + 1}] ${event.title}`);
      console.log(`    ID: ${event.id}`);
      console.log(`    Date: ${event.eventDate.toISOString()}`);
      console.log(`    Location: ${event.location || 'N/A'}`);
      console.log(`    Category: ${event.category || 'N/A'}`);
      console.log(`    Reminders: Morning=${event.morningReminderSent}, 2hr=${event.reminderSent}`);
      if (event.linkedFact) {
        console.log(`    Linked Fact: ${event.linkedFact.content.substring(0, 60)}...`);
      }
      console.log('');
    });
    
    // Query pending scheduled announcements
    const pendingAnnouncements = await prisma.scheduledAnnouncement.findMany({
      where: {
        sent: false,
        scheduledFor: {
          lte: new Date(Date.now() + 24 * 60 * 60 * 1000), // Next 24 hours
        },
      },
      orderBy: {
        scheduledFor: 'asc',
      },
    });
    
    console.log(`\n⏰ PENDING ACTIONABLE ITEMS (Next 24 hours) - ${pendingAnnouncements.length} total\n`);
    pendingAnnouncements.forEach((ann, idx) => {
      console.log(`[${idx + 1}] ${ann.content.substring(0, 80)}...`);
      console.log(`    Scheduled: ${ann.scheduledFor.toISOString()}`);
      console.log(`    ID: ${ann.id}`);
      console.log('');
    });
    
    await prisma.$disconnect();
    
    console.log('=' .repeat(80));
    console.log('\n🧪 Testing Cron Endpoints\n');
    console.log('=' .repeat(80));
    
    // Test cron endpoints
    const cronEndpoints = [
      { name: 'Scheduled Announcements', path: '/api/cron/scheduled-announcements' },
      { name: 'Event Nudges', path: '/api/cron/event-nudges' },
      { name: 'Slack Sync', path: '/api/cron/slack-sync' },
    ];
    
    for (const endpoint of cronEndpoints) {
      console.log(`\n📡 Testing ${endpoint.name}...`);
      console.log(`URL: ${BASE_URL}${endpoint.path}\n`);
      
      try {
        const headers = CRON_SECRET ? { 'Authorization': `Bearer ${CRON_SECRET}` } : {};
        const response = await fetch(`${BASE_URL}${endpoint.path}`, {
          method: 'GET',
          headers,
        });
        
        const data = await response.json();
        console.log(`Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(data, null, 2));
      } catch (error) {
        console.log(`❌ Error: ${error.message}`);
        console.log(`   Make sure the dev server is running on port ${PORT}`);
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

