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

// Lazy-init to support Cloudflare Workers (env vars not available at module load)
let _db: NeonDatabase<typeof schema> | null = null;

export function getDb(): NeonDatabase<typeof schema> {
    if (!_db) {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error('DATABASE_URL is not configured');
        }
        const pool = new Pool({ connectionString });
        _db = drizzle(pool, { schema });
    }
    return _db;
}

// For backwards compatibility - lazy getter
// Note: In CF Workers, always use getDb() to ensure proper initialization
export const db = new Proxy({} as NeonDatabase<typeof schema>, {
    get(_, prop) {
        return getDb()[prop as keyof typeof _db];
    },
});