import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.HOUSE_HUNTER_DB ?? join(process.cwd(), 'data', 'house-hunter.sqlite');

if (!existsSync(dbPath)) {
  console.log(`No database file found at ${dbPath}`);
  process.exit(0);
}

const db = new DatabaseSync(dbPath);
const tables = ['notifications', 'listings', 'geo_cache'];
const before = counts(db, tables);

db.exec(`
  DELETE FROM notifications;
  DELETE FROM listings;
  DELETE FROM geo_cache;
  DELETE FROM sqlite_sequence WHERE name IN ('notifications', 'listings');
  VACUUM;
`);

const after = counts(db, tables);
db.close();

console.log(JSON.stringify({ dbPath, before, after }, null, 2));

function counts(db, tables) {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    ]),
  );
}
