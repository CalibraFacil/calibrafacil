// Conditionally load dotenv in Node.js environments (not needed in CF Workers)
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    try {
        await import('dotenv/config');
    } catch {
        // dotenv not available, likely running in CF Workers
    }
}

import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleNeon, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import postgres from 'postgres';
import { Pool } from '@neondatabase/serverless';
import * as schema from './schema';

type Database = NeonDatabase<typeof schema> | ReturnType<typeof drizzlePostgres<typeof schema>>;

/**
 * Creates a fresh database connection.
 * 
 * Uses different drivers based on environment:
 * - HYPERDRIVE_URL: Uses postgres.js driver (recommended for Cloudflare Hyperdrive)
 * - DATABASE_URL: Uses Neon serverless driver (for local dev or direct connection)
 * 
 * @see https://neon.com/docs/guides/cloudflare-hyperdrive
 * @see https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/
 */
export function getDb(): Database {
    const isProduction = process.env.NODE_ENV === 'production';

    // Prefer direct DATABASE_URL in development to avoid Hyperdrive local overhead.
    const databaseUrl = process.env.DATABASE_URL;
    if (!isProduction && databaseUrl) {
        const pool = new Pool({ connectionString: databaseUrl });
        return drizzleNeon(pool, { schema });
    }

    // Hyperdrive - use postgres.js driver (recommended by Cloudflare and Neon)
    const hyperdriveUrl = process.env.HYPERDRIVE_URL;
    if (hyperdriveUrl) {
        const sql = postgres(hyperdriveUrl, {
            // Limit connections for Workers (concurrent external connection limits)
            max: 5,
            // Disable fetch_types for better performance (avoids extra round-trip)
            fetch_types: false,
        });
        return drizzlePostgres(sql, { schema });
    }

    // Fallback to direct DATABASE_URL when Hyperdrive is not available
    if (databaseUrl) {
        const pool = new Pool({ connectionString: databaseUrl });
        return drizzleNeon(pool, { schema });
    }

    throw new Error('No database connection configured. Set HYPERDRIVE_URL or DATABASE_URL.');
}

// For backwards compatibility - creates a fresh request-safe DB instance on access.
export const db = new Proxy({} as Database, {
    get(_, prop) {
        return getDb()[prop as keyof Database];
    },
});
