# Repository Structure

## Core Directories

### /src
Main application source code

- **/app** - Next.js app router pages and API routes
  - **/api/cron** - Scheduled jobs (event reminders)
  - **/api/text-explorer** - Knowledge base upload/query endpoints
  - **/api/twilio/sms** - SMS webhook handler
  
- **/lib** - Shared libraries and utilities
  - **/planner** - LLM-based conversation planner
    - **/actions** - Action handlers (drafts, polls, content, etc.)
    - **/\_\_tests\_\_** - Unit tests
  - **/repositories** - Database access layer
  - **/utils** - Helper functions
  
- **/text-explorer** - Semantic search and knowledge extraction

### /prisma
Database schema and migrations for Supabase Postgres

### /scripts
Utility scripts for development and testing

### /public
Static assets served at root

### /assets
Documentation assets (screenshots, diagrams)

