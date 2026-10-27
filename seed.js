// Seeds db/airguard.sqlite with sample emission readings from non-polluting
// industries. Replace / extend this with your real collected dataset.
// Run with: npm run seed

const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'db', 'airguard.sqlite'));
db.exec(`
CREATE TABLE IF NOT EXISTS training_data (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  co2  REAL NOT NULL,
  no2  REAL NOT NULL,
  so2  REAL NOT NULL,
  hg   REAL NOT NULL,
  co   REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

const base = { co2: 0.04, no2: 0.0002, so2: 0.0002, hg: 0.000001, co: 0.0005 };

// deterministic pseudo-random generator so the sample set is reproducible
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const insert = db.prepare('INSERT INTO training_data (co2, no2, so2, hg, co) VALUES (@co2, @no2, @so2, @hg, @co)');
const insertMany = db.transaction((rows) => rows.forEach(r => insert.run(r)));

const clearFirst = process.argv.includes('--reset');
if (clearFirst) db.exec('DELETE FROM training_data');

const rows = [];
for (let i = 0; i < 12; i++) {
  rows.push({
    co2: +(base.co2 * (0.75 + rand() * 0.5)).toPrecision(3),
    no2: +(base.no2 * (0.75 + rand() * 0.5)).toPrecision(3),
    so2: +(base.so2 * (0.75 + rand() * 0.5)).toPrecision(3),
    hg: +(base.hg * (0.75 + rand() * 0.5)).toPrecision(3),
    co: +(base.co * (0.75 + rand() * 0.5)).toPrecision(3),
  });
}
insertMany(rows);

console.log(`Seeded ${rows.length} rows into training_data (${clearFirst ? 'reset first' : 'appended'}).`);
db.close();
