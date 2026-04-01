# MemoryLane

MemoryLane is a trip tracking app with map timeline, stop-level details, optional photos, and person-based journey search.

## Stack

- Backend: Node.js + Express
- Database: Firebase Cloud Firestore (via Firebase Admin SDK)
- Uploads: Multer (stores images in `public/uploads`)
- Frontend: HTML/CSS/JS + Leaflet map

## Features

- Add journeys with:
  - title, dates, transport mode, route summary
  - companions
  - ordered stops with mandatory start + end destinations and optional in-between stops
  - map location, stop type, notes, timestamps
  - trip duration auto-calculated from start departure and end arrival
  - optional multi-photo uploads per stop
- Search journeys by person name.
- Open a full details page for each journey from timeline.
- In single journey view, update any stop details, append photos, and delete in-between stops.
- Map route rendering by transport:
  - `car`/`driving`: road-following route using free OSRM demo service
  - `flight`/`plane`/`air`: curved arc route
  - others: straight polyline

## Firebase Setup

1. Create Firebase project:
- Open [Firebase Console](https://console.firebase.google.com/)
- Create a new project

2. Enable Firestore:
- In Firebase Console, open `Build -> Firestore Database`
- Create database (Native mode)

3. Generate service account key:
- Open `Project settings -> Service accounts`
- Click `Generate new private key`
- Save JSON key securely (do not commit)

4. Configure env vars (choose one auth method):
- Recommended: set `GOOGLE_APPLICATION_CREDENTIALS` to service account JSON path
- Or set `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env`
- Do not use deprecated Firebase database secrets / legacy token generators

5. (Optional) set project/collection env vars:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_JOURNEYS_COLLECTION`
- `FIREBASE_JOURNEY_PEOPLE_COLLECTION`

6. Install dependencies and run:

```bash
npm install
npm start
```

7. Open app:
- [http://localhost:3000](http://localhost:3000)
- Same Wi-Fi devices: `http://<your-local-ip>:3000`

## Firestore Security Rules

This app uses Firebase Admin SDK from server-side Express routes. Admin SDK bypasses Firestore client security rules. Keep service account key private and never expose it to browser/client code.

If you also build direct client-side Firestore access later, start with restrictive rules and only open required paths.

## API

- `POST /api/journeys` (multipart/form-data)
  - `payload`: JSON
  - `stopPhoto_0`, `stopPhoto_1`, ... optional image files
- `PATCH /api/journeys/:id/stops` (multipart/form-data)
  - `payload`: JSON with `insertBeforeIndex` and `stop`
  - `stopPhoto` optional images for the inserted stop
- `PATCH /api/journeys/:id/stops/:index` (multipart/form-data)
  - `payload`: JSON with updated `stop`
  - `stopPhoto` optional images to append to existing stop photos
- `DELETE /api/journeys/:id/stops/:index`
  - deletes an in-between stop and reorders remaining stops
- `GET /api/journeys`
- `GET /api/journeys?person=<namePrefix>`
- `GET /api/journeys/:id`

## Data Model (Firestore)

- `journeys/{journeyId}`
  - journey summary fields
  - `companions[]` (`display_name`, `normalized_name`)
  - `companion_search_keys[]`
  - `stops[]` (includes `photos[]`)
- `journey_people/{docId}`
  - `journey_id`
  - `normalized_name`
  - `display_name`
  - used for person search indexing

## Notes

- Existing SQLite file is no longer used by the server.
- If migrating old SQLite data to Firestore is needed, I can add a one-time migration script.
# Memory-Lane
