import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
/**
 * Minimal, dependency-free migration runner.
 * The schema is idempotent, so running it on every deploy is safe.
 */
async function main() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL is required to run migrations.');
        process.exit(1);
    }
    const here = path.dirname(fileURLToPath(import.meta.url));
    const schemaPath = path.join(here, '..', 'src', 'schema.sql');
    const sql = await fs.readFile(schemaPath, 'utf-8');
    const pool = new pg.Pool({ connectionString, max: 1 });
    try {
        console.log('[migrate] applying packages/db/src/schema.sql ...');
        await pool.query(sql);
        console.log('[migrate] done.');
    }
    finally {
        await pool.end();
    }
}
main().catch((err) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
});
//# sourceMappingURL=migrate.js.map