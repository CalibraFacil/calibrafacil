// Conditionally load dotenv in Node.js environments (not needed in CF Workers)
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    try {
        await import('dotenv/config');
    } catch {
        // dotenv not available, likely running in CF Workers
    }
}
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import * as schema from './schema';

/**
 * Creates a fresh database connection.
 * In Cloudflare Workers, each request should create its own connection
 * to avoid I/O context isolation issues.
 */
export function getDb(): NeonDatabase<typeof schema> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not configured');
    }
    const pool = new Pool({ connectionString });
    return drizzle(pool, { schema });
}

// For backwards compatibility - creates fresh connection on each access
// Note: In CF Workers, always use getDb() to ensure proper initialization
export const db = new Proxy({} as NeonDatabase<typeof schema>, {
    get(_, prop) {
        return getDb()[prop as keyof NeonDatabase<typeof schema>];
    },
});