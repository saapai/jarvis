import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

async function createPrismaClientWithTurso(): Promise<PrismaClient> {
  const { PrismaLibSql } = await import('@prisma/adapter-libsql')
  const { createClient } = await import('@libsql/client')
  
  const libsql = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaLibSql(libsql as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any)
}

function createPrismaClient(): PrismaClient {
  // Local development with SQLite file
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

// Use Turso in production (when env vars are set), otherwise local SQLite
const useTurso = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN)

let prismaPromise: Promise<PrismaClient> | null = null

export async function getPrisma(): Promise<PrismaClient> {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma
  }
  
  if (!prismaPromise) {
    prismaPromise = useTurso 
      ? createPrismaClientWithTurso()
      : Promise.resolve(createPrismaClient())
  }
  
  const client = await prismaPromise
  globalForPrisma.prisma = client
  return client
}

// For backwards compatibility - but prefer getPrisma() for async access
export const prisma = useTurso 
  ? (null as unknown as PrismaClient) // Will be set async
  : (globalForPrisma.prisma ?? createPrismaClient())

if (!useTurso && process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

