const express = require('express');
const { db, collections } = require('../db/firestore');
const upload = require('../middleware/upload');

const router = express.Router();

function normalizeName(name) {
  return name.trim().toLowerCase();
}

function parsePayload(req) {
  const raw = req.body.payload;
  if (!raw) {
    throw new Error('Missing payload JSON.');
  }

  const parsed = JSON.parse(raw);
  if (!parsed.title || !parsed.startDate || !Array.isArray(parsed.stops) || parsed.stops.length < 2) {
    throw new Error('Payload must include title, startDate, and at least two stops (start and end).');
  }

  return parsed;
}

function validateStopLocations(payload) {
  payload.stops.forEach((stop, idx) => {
    if (!stop.name || stop.latitude === undefined || stop.longitude === undefined) {
      throw new Error(`Stop ${idx + 1} is missing required name/location.`);
    }

    if (Number.isNaN(Number(stop.latitude)) || Number.isNaN(Number(stop.longitude))) {
      throw new Error(`Stop ${idx + 1} has invalid map coordinates.`);
    }
  });

  if (payload.stops.length < 2) {
    throw new Error('Journey must include both a start destination and an end destination.');
  }

  const startStop = payload.stops[0];
  const endStop = payload.stops[payload.stops.length - 1];

  if (!startStop.departedAt) {
    throw new Error('Start destination must include departure time.');
  }

  if (!endStop.arrivedAt) {
    throw new Error('End destination must include arrival time.');
  }

  const startDeparted = new Date(startStop.departedAt).getTime();
  const endArrived = new Date(endStop.arrivedAt).getTime();

  if (Number.isNaN(startDeparted) || Number.isNaN(endArrived)) {
    throw new Error('Invalid start/end timestamps for duration calculation.');
  }

  if (endArrived < startDeparted) {
    throw new Error('End arrival time must be after start departure time.');
  }
}

function mapFilesByField(files) {
  const byField = new Map();
  for (const file of files) {
    if (!byField.has(file.fieldname)) {
      byField.set(file.fieldname, []);
    }
    byField.get(file.fieldname).push(file);
  }
  return byField;
}

function buildCompanionRecords(companions) {
  const unique = new Map();

  (companions || []).forEach((name) => {
    if (!name || !name.trim()) {
      return;
    }

    const displayName = name.trim();
    const normalizedName = normalizeName(displayName);

    if (!unique.has(normalizedName)) {
      unique.set(normalizedName, {
        display_name: displayName,
        normalized_name: normalizedName
      });
    }
  });

  return Array.from(unique.values());
}

function buildStops(payload, filesByField) {
  const lastIndex = payload.stops.length - 1;
  return payload.stops.map((stop, idx) => {
    const key = `stopPhoto_${idx}`;
    const spotFiles = filesByField.get(key) || [];
    const photos = spotFiles.map((file) => `/uploads/${file.filename}`);

    return {
      order_index: idx,
      name: stop.name,
      stop_type: stop.stopType || 'other',
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
      arrived_at: idx === 0 ? null : stop.arrivedAt || null,
      departed_at: idx === lastIndex ? null : stop.departedAt || null,
      notes: stop.notes || null,
      photos
    };
  });
}

function computeDurationMinutesFromStops(stops) {
  if (!stops.length) {
    return null;
  }

  const start = stops[0];
  const end = stops[stops.length - 1];
  const startDeparted = start.departed_at ? new Date(start.departed_at).getTime() : NaN;
  const endArrived = end.arrived_at ? new Date(end.arrived_at).getTime() : NaN;

  if (Number.isNaN(startDeparted) || Number.isNaN(endArrived) || endArrived < startDeparted) {
    return null;
  }

  return Math.round((endArrived - startDeparted) / 60000);
}

function toListItem(id, journey) {
  return {
    id,
    title: journey.title,
    start_date: journey.start_date,
    end_date: journey.end_date || null,
    transport_mode: journey.transport_mode || null,
    total_duration_minutes: journey.total_duration_minutes || null,
    route_summary: journey.route_summary || null
  };
}

function buildSingleStop(stopInput, photos) {
  return {
    name: stopInput.name,
    stop_type: stopInput.stopType || 'other',
    latitude: Number(stopInput.latitude),
    longitude: Number(stopInput.longitude),
    arrived_at: stopInput.arrivedAt || null,
    departed_at: stopInput.departedAt || null,
    notes: stopInput.notes || null,
    photos
  };
}

function parseInsertStopPayload(req) {
  const raw = req.body.payload;
  if (!raw) {
    throw new Error('Missing payload JSON.');
  }

  const parsed = JSON.parse(raw);
  const insertBeforeIndex = Number(parsed.insertBeforeIndex);
  const stop = parsed.stop;

  if (!Number.isInteger(insertBeforeIndex)) {
    throw new Error('insertBeforeIndex must be an integer.');
  }

  if (!stop || !stop.name || stop.latitude === undefined || stop.longitude === undefined) {
    throw new Error('Stop must include name and map location.');
  }

  if (Number.isNaN(Number(stop.latitude)) || Number.isNaN(Number(stop.longitude))) {
    throw new Error('Stop has invalid map coordinates.');
  }

  return {
    insertBeforeIndex,
    stop
  };
}

router.post('/', upload.any(), async (req, res) => {
  try {
    const payload = parsePayload(req);
    validateStopLocations(payload);

    const filesByField = mapFilesByField(req.files || []);
    const companions = buildCompanionRecords(payload.companions || []);
    const stops = buildStops(payload, filesByField);
    const totalDurationMinutes = computeDurationMinutesFromStops(stops);

    const journeyRef = db.collection(collections.journeys).doc();
    const createdAt = Date.now();

    const journeyDoc = {
      title: payload.title,
      description: payload.description || null,
      start_date: payload.startDate,
      end_date: payload.endDate || null,
      transport_mode: payload.transportMode || null,
      total_duration_minutes: totalDurationMinutes,
      route_summary: payload.routeSummary || null,
      companions,
      companion_search_keys: companions.map((person) => person.normalized_name),
      stops,
      start_destination: stops[0] || null,
      end_destination: stops[stops.length - 1] || null,
      created_at: createdAt
    };

    const batch = db.batch();
    batch.set(journeyRef, journeyDoc);

    companions.forEach((person) => {
      const personRef = db.collection(collections.journeyPeople).doc();
      batch.set(personRef, {
        journey_id: journeyRef.id,
        normalized_name: person.normalized_name,
        display_name: person.display_name,
        start_date: payload.startDate,
        created_at: createdAt
      });
    });

    await batch.commit();

    res.status(201).json({
      success: true,
      journeyId: journeyRef.id
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

router.patch('/:id/stops', upload.any(), async (req, res) => {
  try {
    const journeyId = req.params.id;
    const { insertBeforeIndex, stop } = parseInsertStopPayload(req);
    const newStopPhotos = (req.files || []).map((file) => `/uploads/${file.filename}`);

    const result = await db.runTransaction(async (transaction) => {
      const journeyRef = db.collection(collections.journeys).doc(journeyId);
      const snapshot = await transaction.get(journeyRef);

      if (!snapshot.exists) {
        throw new Error('Journey not found.');
      }

      const journey = snapshot.data();
      const existingStops = Array.isArray(journey.stops) ? journey.stops : [];
      if (existingStops.length < 2) {
        throw new Error('Journey data is invalid: start/end destinations are missing.');
      }

      if (insertBeforeIndex < 1 || insertBeforeIndex > existingStops.length - 1) {
        throw new Error('insertBeforeIndex must place stop between start and end destinations.');
      }

      const insertedStop = buildSingleStop(stop, newStopPhotos);
      const updatedStops = [...existingStops];
      updatedStops.splice(insertBeforeIndex, 0, insertedStop);

      const reindexedStops = updatedStops.map((item, idx) => ({
        ...item,
        order_index: idx
      }));

      const totalDurationMinutes = computeDurationMinutesFromStops(reindexedStops);
      const now = Date.now();

      transaction.update(journeyRef, {
        stops: reindexedStops,
        total_duration_minutes: totalDurationMinutes,
        start_destination: reindexedStops[0],
        end_destination: reindexedStops[reindexedStops.length - 1],
        updated_at: now
      });

      return {
        stopsCount: reindexedStops.length
      };
    });

    res.json({
      success: true,
      message: 'Stop inserted successfully.',
      stopsCount: result.stopsCount
    });
  } catch (error) {
    const status = error.message === 'Journey not found.' ? 404 : 400;
    res.status(status).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const person = (req.query.person || '').toString().trim().toLowerCase();

    if (!person) {
      const snapshot = await db.collection(collections.journeys).orderBy('start_date', 'desc').get();
      const rows = snapshot.docs.map((doc) => toListItem(doc.id, doc.data()));
      rows.sort((a, b) => {
        if (a.start_date === b.start_date) {
          return 0;
        }
        return a.start_date > b.start_date ? -1 : 1;
      });
      res.json(rows);
      return;
    }

    const peopleSnapshot = await db
      .collection(collections.journeyPeople)
      .where('normalized_name', '>=', person)
      .where('normalized_name', '<=', `${person}\uf8ff`)
      .get();

    const uniqueJourneyIds = Array.from(new Set(peopleSnapshot.docs.map((doc) => doc.data().journey_id)));

    if (uniqueJourneyIds.length === 0) {
      res.json([]);
      return;
    }

    const journeyDocs = await Promise.all(
      uniqueJourneyIds.map((journeyId) => db.collection(collections.journeys).doc(journeyId).get())
    );

    const rows = journeyDocs
      .filter((doc) => doc.exists)
      .map((doc) => toListItem(doc.id, doc.data()))
      .sort((a, b) => {
        if (a.start_date === b.start_date) {
          return 0;
        }
        return a.start_date > b.start_date ? -1 : 1;
      });

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to list journeys.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const journeyId = req.params.id;
    const journeyDoc = await db.collection(collections.journeys).doc(journeyId).get();

    if (!journeyDoc.exists) {
      res.status(404).json({ error: 'Journey not found.' });
      return;
    }

    const journey = journeyDoc.data();
    const companions = (journey.companions || []).map((person) => person.display_name);

    res.json({
      id: journeyDoc.id,
      title: journey.title,
      description: journey.description || null,
      start_date: journey.start_date,
      end_date: journey.end_date || null,
      transport_mode: journey.transport_mode || null,
      total_duration_minutes: journey.total_duration_minutes || null,
      route_summary: journey.route_summary || null,
      companions,
      spots: journey.stops || [],
      start_destination: journey.start_destination || null,
      end_destination: journey.end_destination || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to load journey.' });
  }
});

module.exports = router;
