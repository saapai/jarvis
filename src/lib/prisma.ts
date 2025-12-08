import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

let prismaPromise: Promise<PrismaClient> | null = null

export async function getPrisma(): Promise<PrismaClient> {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma
  }
  
  if (!prismaPromise) {
    prismaPromise = Promise.resolve(createPrismaClient())
  }
  
  const client = await prismaPromise
  globalForPrisma.prisma = client
  return client
}

// For backwards compatibility - prefer getPrisma() for async access
export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

