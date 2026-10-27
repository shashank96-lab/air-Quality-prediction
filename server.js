// AirGuard AI — backend
// Stores the non-polluting-industry training database in SQL (SQLite file on disk).
// The raw rows NEVER get sent to the browser — only aggregate statistics
// (mean / std-dev per gas) and prediction results cross the API boundary.

const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'db', 'airguard.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ---------- schema ----------
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

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

const GASES = ['co2', 'no2', 'so2', 'hg', 'co'];
const GAS_LABEL = { co2: 'CO2', no2: 'NO2', so2: 'SO2', hg: 'Hg', co: 'CO' };
const GAS_WEIGHT = { co2: .15, no2: .2, so2: .2, hg: .3, co: .15 };

const DEFAULT_LEVELS = [
  ['Non-polluted', 0, '#16a34a'],
  ['Low', 10, '#65a30d'],
  ['Medium', 25, '#ca8a04'],
  ['Unhealthy', 40, '#ea580c'],
  ['Poor', 55, '#dc2626'],
  ['Dangerous', 70, '#b91c1c'],
  ['Hazardous', 82, '#7f1d1d'],
  ['More hazardous', 92, '#450a0a'],
];
const DEFAULT_CFG = { dispersionLength: 150, sensitivity: 2.5, maxLivableLevel: 2, closureTriggerLevel: 6, closureRadiusLimit: 500 };

function getConfig() {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const map = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
  return {
    levels: map.levels || DEFAULT_LEVELS,
    cfg: map.cfg || DEFAULT_CFG,
  };
}
function setConfig(key, value) {
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value));
}

// ---------- stats (mean / std-dev learned from the training DB) ----------
// Only ever returns aggregates — never the individual rows.
function learnedStats() {
  const countRow = db.prepare('SELECT COUNT(*) AS n FROM training_data').get();
  const n = countRow.n;
  if (n === 0) {
    // fallback so the app still works before any data is seeded
    const fallbackMean = { co2: .04, no2: .0002, so2: .0002, hg: .000001, co: .0005 };
    return GASES.map(k => ({ gas: k, label: GAS_LABEL[k], mean: fallbackMean[k], std: Math.max(fallbackMean[k] * .2, 1e-9) }));
  }
  return GASES.map(k => {
    const { avg } = db.prepare(`SELECT AVG(${k}) AS avg FROM training_data`).get();
    const { sq } = db.prepare(`SELECT SUM((${k}-?)*(${k}-?)) AS sq FROM training_data`).get(avg, avg);
    const std = Math.sqrt(sq / n);
    return { gas: k, label: GAS_LABEL[k], mean: avg, std: Math.max(std, avg * .05, 1e-12) };
  });
}

// ---------- hazard model ----------
function scoreGas(x, stat, sensitivity) {
  const z = (x - stat.mean) / stat.std;
  return 100 * (1 - Math.exp(-Math.max(0, z) / sensitivity));
}
function hazardOf(input, stats, sensitivity) {
  const scores = stats.map(s => scoreGas(input[s.gas] || 0, s, sensitivity));
  const weighted = stats.reduce((sum, s, i) => sum + scores[i] * GAS_WEIGHT[s.gas], 0);
  const H = 0.5 * weighted + 0.5 * Math.max(...scores);
  return { scores, H };
}
function levelIndex(H, levels) {
  let idx = 0;
  levels.forEach((l, i) => { if (H >= l[1]) idx = i; });
  return idx;
}
function radiusAt(H, levelThreshold, dispersionLength) {
  return levelThreshold > 0 && H > levelThreshold ? dispersionLength * Math.log(H / levelThreshold) : 0;
}

// ---------- app ----------
const app = express();


app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Aggregate learned profile only — safe to expose, no raw rows.
app.get('/api/stats', (req, res) => {
  res.json({ stats: learnedStats(), rowCount: db.prepare('SELECT COUNT(*) AS n FROM training_data').get().n });
});

app.get('/api/config', (req, res) => res.json(getConfig()));

app.post('/api/config', (req, res) => {
  const { levels, cfg } = req.body || {};
  if (levels) setConfig('levels', levels);
  if (cfg) setConfig('cfg', cfg);
  res.json(getConfig());
});

// Core prediction endpoint — the browser only ever sends/receives this shape.
app.post('/api/predict', (req, res) => {
  const input = req.body || {};
  const { levels, cfg } = getConfig();
  const stats = learnedStats();
  const { scores, H } = hazardOf(input, stats, cfg.sensitivity);
  const li = levelIndex(H, levels);

  const radii = levels.map((l, i) => radiusAt(H, l[1], cfg.dispersionLength));
  const unsafeRadius = radii[cfg.maxLivableLevel + 1] || 0;
  const closureRadius = radii[cfg.closureTriggerLevel] || 0;
  const mustClose = closureRadius > cfg.closureRadiusLimit;

  // suggested reductions: bring any gas above mean+std back down to mean+std
  const suggestions = stats
    .map((s, i) => ({ gas: s.gas, label: s.label, value: input[s.gas] || 0, target: s.mean + s.std, score: scores[i] }))
    .filter(s => s.value > s.target)
    .sort((a, b) => b.score - a.score)
    .map(s => ({ ...s, cutPercent: Math.round((1 - s.target / s.value) * 100) }));

  res.json({
    hazardPercent: H,
    levelIndex: li,
    levelName: levels[li][0],
    levelColor: levels[li][2],
    perGas: stats.map((s, i) => ({ gas: s.gas, label: s.label, score: scores[i] })),
    radii,
    unsafeRadius,
    closureRadius,
    mustClose,
    suggestions,
    levels,
    cfg,
  });
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AirGuard AI server running → http://localhost:${PORT}`));
