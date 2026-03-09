const journeyTitle = document.getElementById('journeyTitle');
const journeyMeta = document.getElementById('journeyMeta');
const journeyPeople = document.getElementById('journeyPeople');
const journeyRoute = document.getElementById('journeyRoute');
const stopsDetail = document.getElementById('stopsDetail');
const insertStopForm = document.getElementById('insertStopForm');
const insertBeforeIndexSelect = document.getElementById('insertBeforeIndex');
const insertStopStatus = document.getElementById('insertStopStatus');
const pickNewStopLocationBtn = document.getElementById('pickNewStopLocationBtn');
const newStopLocationPreview = document.getElementById('newStopLocationPreview');
const newStopSearchInput = document.getElementById('newStopSearchInput');
const searchNewStopBtn = document.getElementById('searchNewStopBtn');
const newStopSearchResults = document.getElementById('newStopSearchResults');
const newStopLat = document.getElementById('newStopLat');
const newStopLng = document.getElementById('newStopLng');
const newStopName = document.getElementById('newStopName');
const newStopType = document.getElementById('newStopType');
const newStopArrivedAt = document.getElementById('newStopArrivedAt');
const newStopDepartedAt = document.getElementById('newStopDepartedAt');
const newStopNotes = document.getElementById('newStopNotes');
const newStopPhotos = document.getElementById('newStopPhotos');

const map = L.map('journeyMap').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let journeyLayers = [];
let addStopMarker = null;
let isPickingNewStopLocation = false;

function getJourneyId() {
  const params = new URLSearchParams(window.location.search);
  const id = (params.get('id') || '').trim();
  return id ? id : null;
}

function stopCardHtml(stop, index) {
  const photos = (stop.photos || [])
    .map((path, photoIndex) => `<img src="${path}" alt="${stop.name} photo ${photoIndex + 1}" class="stop-photo" />`)
    .join('');

  return `
    <article class="timeline-card">
      <h3>${index + 1}. ${stop.name}</h3>
      <p class="timeline-meta">Type: ${stop.stop_type || 'other'}</p>
      <p class="timeline-meta">Location: ${stop.latitude}, ${stop.longitude}</p>
      <p class="timeline-meta">Arrived: ${stop.arrived_at || 'N/A'} | Departed: ${stop.departed_at || 'N/A'}</p>
      <p>${stop.notes || ''}</p>
      <p class="timeline-meta">Photos: ${(stop.photos || []).length}</p>
      <div class="stop-photos-grid">${photos || '<p class="timeline-meta">No photos added.</p>'}</div>
    </article>
  `;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

async function searchPlace(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Unable to search location right now.');
  }

  return response.json();
}

function renderSearchResults(results) {
  const options = ['<option value="">Choose a search result</option>'];
  results.forEach((item) => {
    const optionValue = `${item.lat},${item.lon}`;
    const label = item.display_name.replace(/"/g, '&quot;');
    options.push(`<option value="${optionValue}">${label}</option>`);
  });
  newStopSearchResults.innerHTML = options.join('');
}

function setNewStopLocation(lat, lng) {
  newStopLat.value = Number(lat).toFixed(6);
  newStopLng.value = Number(lng).toFixed(6);
  newStopLocationPreview.textContent = `Selected: ${newStopLat.value}, ${newStopLng.value}`;

  if (addStopMarker) {
    map.removeLayer(addStopMarker);
  }

  addStopMarker = L.circleMarker([lat, lng], {
    radius: 7,
    color: '#9b2226',
    fillColor: '#ca6702',
    fillOpacity: 0.9
  }).addTo(map);
}

function normalizeTransportMode(mode) {
  return (mode || '').toString().trim().toLowerCase();
}

function isCarTransport(mode) {
  const normalized = normalizeTransportMode(mode);
  return normalized.includes('car') || normalized.includes('drive') || normalized.includes('road');
}

function isFlightTransport(mode) {
  const normalized = normalizeTransportMode(mode);
  return normalized.includes('flight') || normalized.includes('plane') || normalized.includes('air');
}

function buildFlightArcSegment(start, end, steps = 24) {
  const [startLat, startLng] = start;
  const [endLat, endLng] = end;

  const latDelta = endLat - startLat;
  const lngDelta = endLng - startLng;
  const distance = Math.sqrt(latDelta * latDelta + lngDelta * lngDelta);
  const curvature = Math.max(0.2, distance * 0.18);

  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const baseLat = startLat + latDelta * t;
    const baseLng = startLng + lngDelta * t;
    const bump = Math.sin(Math.PI * t) * curvature;
    points.push([baseLat + bump, baseLng]);
  }
  return points;
}

async function fetchDrivingSegment(start, end) {
  const [startLat, startLng] = start;
  const [endLat, endLng] = end;
  const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Road routing request failed.');
  }
  const data = await response.json();
  const route = data && data.routes && data.routes[0];
  if (!route || !route.geometry || !Array.isArray(route.geometry.coordinates)) {
    throw new Error('Road routing response missing coordinates.');
  }
  return route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

async function buildMapRoutePoints(basePoints, transportMode) {
  if (basePoints.length < 2) {
    return basePoints;
  }

  if (isCarTransport(transportMode)) {
    try {
      const routePoints = [];
      for (let i = 0; i < basePoints.length - 1; i += 1) {
        const segment = await fetchDrivingSegment(basePoints[i], basePoints[i + 1]);
        if (i > 0 && segment.length > 0) {
          segment.shift();
        }
        routePoints.push(...segment);
      }
      if (routePoints.length > 1) {
        return routePoints;
      }
    } catch (_error) {
      return basePoints;
    }
  }

  if (isFlightTransport(transportMode)) {
    const arcPoints = [];
    for (let i = 0; i < basePoints.length - 1; i += 1) {
      const segment = buildFlightArcSegment(basePoints[i], basePoints[i + 1]);
      if (i > 0 && segment.length > 0) {
        segment.shift();
      }
      arcPoints.push(...segment);
    }
    return arcPoints.length > 1 ? arcPoints : basePoints;
  }

  return basePoints;
}

async function renderJourneyOnMap(journey) {
  journeyLayers.forEach((layer) => map.removeLayer(layer));
  journeyLayers = [];

  const points = journey.spots.map((spot) => [spot.latitude, spot.longitude]);
  const routePoints = await buildMapRoutePoints(points, journey.transport_mode);
  if (!routePoints.length) {
    return;
  }

  const line = L.polyline(routePoints, { color: '#ca6702', weight: 4 }).addTo(map);
  journeyLayers.push(line);

  journey.spots.forEach((spot, idx) => {
    const marker = L.marker([spot.latitude, spot.longitude])
      .addTo(map)
      .bindPopup(`<strong>${spot.name}</strong><br/>Stop #${idx + 1}<br/>Photos: ${(spot.photos || []).length}`);
    journeyLayers.push(marker);
  });

  map.fitBounds(routePoints, { padding: [20, 20] });
}

function populateInsertPositionOptions(spots) {
  const options = ['<option value="">Select position</option>'];
  for (let i = 1; i < spots.length; i += 1) {
    const stop = spots[i];
    options.push(`<option value="${i}">Before Stop #${i + 1}: ${stop.name}</option>`);
  }
  insertBeforeIndexSelect.innerHTML = options.join('');
}

async function loadJourney() {
  const journeyId = getJourneyId();
  if (!journeyId) {
    journeyTitle.textContent = 'Invalid journey id.';
    return;
  }

  const res = await fetch(`/api/journeys/${journeyId}`);
  if (!res.ok) {
    journeyTitle.textContent = 'Journey not found.';
    return;
  }

  const journey = await res.json();

  journeyTitle.textContent = journey.title;
  journeyMeta.textContent = `${journey.start_date}${journey.end_date ? ` to ${journey.end_date}` : ''} | ${journey.transport_mode || 'N/A'} | ${journey.total_duration_minutes || 'N/A'} mins`;
  journeyPeople.textContent = `People: ${journey.companions.join(', ') || 'Solo'}`;
  const startName = journey.spots[0] ? journey.spots[0].name : 'N/A';
  const endName = journey.spots.length ? journey.spots[journey.spots.length - 1].name : 'N/A';
  journeyRoute.textContent = `${journey.route_summary || ''} Start: ${startName} | End: ${endName}`;
  await renderJourneyOnMap(journey);
  populateInsertPositionOptions(journey.spots);

  stopsDetail.innerHTML = journey.spots.map((stop, index) => stopCardHtml(stop, index)).join('');
}

map.on('click', (event) => {
  if (!isPickingNewStopLocation) {
    return;
  }
  setNewStopLocation(event.latlng.lat, event.latlng.lng);
  isPickingNewStopLocation = false;
  pickNewStopLocationBtn.classList.remove('active-pick');
  insertStopStatus.textContent = 'Location selected for new stop.';
});

pickNewStopLocationBtn.addEventListener('click', () => {
  isPickingNewStopLocation = true;
  pickNewStopLocationBtn.classList.add('active-pick');
  insertStopStatus.textContent = 'Click on the map to set the new stop location.';
});

searchNewStopBtn.addEventListener('click', async () => {
  const query = newStopSearchInput.value.trim();
  if (!query) {
    insertStopStatus.textContent = 'Type a place name before searching.';
    return;
  }

  insertStopStatus.textContent = 'Searching places...';
  try {
    const results = await searchPlace(query);
    if (!results.length) {
      renderSearchResults([]);
      insertStopStatus.textContent = 'No place found for that search.';
      return;
    }
    renderSearchResults(results);
    insertStopStatus.textContent = `Found ${results.length} places. Choose one from dropdown.`;
  } catch (error) {
    insertStopStatus.textContent = error.message || 'Location search failed.';
  }
});

newStopSearchResults.addEventListener('change', () => {
  if (!newStopSearchResults.value) {
    return;
  }

  const [lat, lng] = newStopSearchResults.value.split(',').map((v) => Number(v));
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    insertStopStatus.textContent = 'Invalid search result selected.';
    return;
  }

  setNewStopLocation(lat, lng);
  map.setView([lat, lng], 13);
  insertStopStatus.textContent = 'Location selected from search.';
});

insertStopForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const journeyId = getJourneyId();
  if (!journeyId) {
    insertStopStatus.textContent = 'Invalid journey id.';
    return;
  }

  const insertBeforeIndex = Number(insertBeforeIndexSelect.value);
  if (!Number.isInteger(insertBeforeIndex)) {
    insertStopStatus.textContent = 'Choose where to insert this stop.';
    return;
  }

  const latitude = Number(newStopLat.value);
  const longitude = Number(newStopLng.value);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    insertStopStatus.textContent = 'Select a map location for the new stop.';
    return;
  }

  const payload = {
    insertBeforeIndex,
    stop: {
      name: newStopName.value.trim(),
      stopType: newStopType.value || 'other',
      latitude,
      longitude,
      arrivedAt: toIso(newStopArrivedAt.value),
      departedAt: toIso(newStopDepartedAt.value),
      notes: newStopNotes.value || null
    }
  };

  if (!payload.stop.name) {
    insertStopStatus.textContent = 'Stop name is required.';
    return;
  }

  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  Array.from(newStopPhotos.files || []).forEach((file) => {
    formData.append('stopPhoto', file);
  });

  insertStopStatus.textContent = 'Inserting stop...';

  const response = await fetch(`/api/journeys/${journeyId}/stops`, {
    method: 'PATCH',
    body: formData
  });
  const result = await response.json();

  if (!response.ok) {
    insertStopStatus.textContent = result.error || 'Unable to insert stop.';
    return;
  }

  insertStopStatus.textContent = 'Stop inserted successfully.';
  insertStopForm.reset();
  newStopLat.value = '';
  newStopLng.value = '';
  newStopLocationPreview.textContent = 'No map point selected';
  if (addStopMarker) {
    map.removeLayer(addStopMarker);
    addStopMarker = null;
  }
  await loadJourney();
});

loadJourney();
