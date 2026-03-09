const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function readServiceAccountFromPath(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Firebase service account file not found at: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw);
}

function initializeFirebaseApp() {
  if (getApps().length > 0) {
    return;
  }

  const deprecatedSecret = process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_SECRET;
  if (deprecatedSecret) {
    throw new Error(
      'Deprecated Firebase database secret detected. Use Firebase Admin SDK credentials via FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS.'
    );
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (serviceAccountPath) {
    const serviceAccount = readServiceAccountFromPath(serviceAccountPath);
    initializeApp({
      credential: cert(serviceAccount),
      projectId: projectId || serviceAccount.project_id
    });
    return;
  }

  try {
    initializeApp({
      credential: applicationDefault(),
      ...(projectId ? { projectId } : {})
    });
  } catch (error) {
    throw new Error(
      'Firebase credentials not found. Set FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS.'
    );
  }
}

initializeFirebaseApp();

const db = getFirestore();

const collections = {
  journeys: process.env.FIREBASE_JOURNEYS_COLLECTION || 'journeys',
  journeyPeople: process.env.FIREBASE_JOURNEY_PEOPLE_COLLECTION || 'journey_people'
};

module.exports = {
  db,
  collections
};
