# AirGuard AI (SQL-backed)

An industrial air-hazard predictor. The training database (emission readings
from non-polluting industries) is stored in a real SQL database (SQLite) on
the server. **The raw rows are never sent to the browser** — the webpage only
ever receives:
- the learned aggregate mean/std per gas (`/api/stats`),
- prediction results (`/api/predict`),
- the dynamic settings (`/api/config`).

## Project layout
```
airguard/
├─ server.js        → Express server + SQL queries + hazard model
├─ seed.js           → populates the SQLite DB with sample industry data
├─ package.json
├─ db/
│  └─ airguard.sqlite  → created automatically on first run
└─ public/
   └─ index.html      → frontend (fetches from the API only)
```

## Run it in VS Code
1. Open this `airguard` folder in VS Code (File → Open Folder…).
2. Open a terminal in VS Code (Terminal → New Terminal). You need Node.js
   installed (v18+ recommended).
3. Install dependencies:
   ```bash
   npm install
   ```
4. Seed the training database with sample data:
   ```bash
   npm run seed
   ```
   (Run `npm run seed:reset` instead if you want to wipe and reseed.)
5. Start the server:
   ```bash
   npm start
   ```
6. Open **http://localhost:3000** in your browser.

## Adding your real industry data
Don't edit the UI — there isn't one for this on purpose, so the dataset stays
off-screen. Instead, either:
- edit the sample rows in `seed.js` and re-run `npm run seed:reset`, or
- insert rows directly into the SQLite file with any SQL tool, e.g.:
  ```sql
  INSERT INTO training_data (co2, no2, so2, hg, co) VALUES (0.038, 0.00019, 0.00021, 0.0000009, 0.00048);
  ```
  (VS Code extensions like "SQLite Viewer" or "SQLite" let you browse/edit
  `db/airguard.sqlite` visually if you ever need to.)

## Dynamic hazard ranges
The "Dynamic settings" card on the page lets you edit, per deployment:
- the 8 hazard level boundaries (Non-polluted → More hazardous),
- the dispersion length and model sensitivity,
- the max livable level and the closure-trigger level,
- the closure radius limit (default 500 m).

These are saved to the `config` table via `POST /api/config` and immediately
affect every prediction — no code changes needed to retune the model.
