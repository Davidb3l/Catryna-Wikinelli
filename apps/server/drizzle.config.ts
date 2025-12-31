import { defineConfig } from 'drizzle-kit'

const isLocal = process.env.CATRYNA_MODE === 'local'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: isLocal ? 'sqlite' : 'postgresql',
  dbCredentials: isLocal
    ? { url: './catryna.db' }
    : { url: process.env.DATABASE_URL! },
})
