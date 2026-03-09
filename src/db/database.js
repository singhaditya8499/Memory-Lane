const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'memorylane.db');
const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS journeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    transport_mode TEXT,
    total_duration_minutes INTEGER,
    route_summary TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS companions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journey_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS journey_people (
    journey_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    PRIMARY KEY (journey_id, person_id),
    FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS spots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journey_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    stop_type TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    arrived_at TEXT,
    departed_at TEXT,
    notes TEXT,
    order_index INTEGER NOT NULL,
    FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS spot_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spot_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    uploaded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (spot_id) REFERENCES spots(id) ON DELETE CASCADE
  );
`);

const spotColumns = db.prepare('PRAGMA table_info(spots)').all().map((col) => col.name);
if (!spotColumns.includes('stop_type')) {
  db.exec('ALTER TABLE spots ADD COLUMN stop_type TEXT');
}

const legacyCompanions = db.prepare('SELECT journey_id, name FROM companions').all();
const selectPerson = db.prepare('SELECT id FROM people WHERE normalized_name = ?');
const createPerson = db.prepare('INSERT INTO people (display_name, normalized_name) VALUES (?, ?)');
const linkJourneyPerson = db.prepare('INSERT OR IGNORE INTO journey_people (journey_id, person_id) VALUES (?, ?)');

const backfillPeople = db.transaction(() => {
  for (const row of legacyCompanions) {
    if (!row.name || !row.name.trim()) {
      continue;
    }

    const displayName = row.name.trim();
    const normalizedName = displayName.toLowerCase();
    let person = selectPerson.get(normalizedName);

    if (!person) {
      const result = createPerson.run(displayName, normalizedName);
      person = { id: result.lastInsertRowid };
    }

    linkJourneyPerson.run(row.journey_id, person.id);
  }
});

backfillPeople();

module.exports = db;
