import { readFile, readdir } from 'node:fs/promises';
import { pool } from '../apps/api/src/lib/db';
let failures = 0;
for (const name of (await readdir('supabase/tests')).filter((n) => n.endsWith('.sql')).sort()) {
  const db = await pool.connect();
  try {
    const result = await db.query(await readFile(`supabase/tests/${name}`, 'utf8'));
    const rows = (Array.isArray(result) ? result : [result]).flatMap((r) => r.rows);
    for (const row of rows)
      for (const value of Object.values(row))
        if (typeof value === 'string') {
          console.log(value);
          if (/^not ok|^# (Looks like|Failed)/m.test(value)) failures++;
        }
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
}
await pool.end();
if (failures) process.exit(1);
