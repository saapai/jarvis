/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // These suites hit the live LLM. The classifier runs on gpt-4o (slower than
  // mini) and the multi-turn scenario tests chain several calls, so cap parallel
  // workers to stay under OpenAI's rate limit — otherwise many workers fire at
  // once, get throttled, retry, and blow past the timeout. Production is
  // unaffected (one SMS at a time). Timeout is generous for the longest chains.
  maxWorkers: 2,
  testTimeout: 90000,
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json'
    }]
  },
  collectCoverageFrom: [
    'src/lib/planner/**/*.ts',
    '!src/lib/planner/**/*.test.ts',
    '!src/lib/planner/__tests__/**'
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50
    }
  }
}

module.exports = config

