const stopsContainer = document.getElementById('stopsContainer');
const addStopBtn = document.getElementById('addStopBtn');
const journeyForm = document.getElementById('journeyForm');
const statusMsg = document.getElementById('statusMsg');
const timelineEl = document.getElementById('timeline');

let stopCount = 0;
let activeLocationStopIndex = null;

const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const journeyLayers = [];
const pickerMarkers = new Map();

const timelineSearchBar = document.createElement('div');
timelineSearchBar.className = 'timeline-search';
timelineSearchBar.innerHTML = `
  <label>Search By Person
    <input id="personFilter" placeholder="Type a name and press Enter" />
  </label>
`;
timelineEl.before(timelineSearchBar);
const personFilterInput = document.getElementById('personFilter');

function stopCardTemplate(index) {
  return `
    <div class="stop-card" data-stop-index="${index}">
      <p class="stop-role-label" id="stopRole_${index}">Stop</p>
      <label>Stop Name<input name="stopName_${index}" required /></label>
      <label>Stop Type
        <select name="stopType_${index}">
          <option value="restaurant">Restaurant</option>
          <option value="loo_stop">Loo Stop</option>
          <option value="shopping_stop">Shopping Stop</option>
          <option value="tourist_stop">Tourist Stop</option>
          <option value="hotel_stop">Hotel Stop</option>
          <option value="fuel_stop">Fuel Stop</option>
          <option value="other">Other</option>
        </select>
      </label>
      <div class="location-row">
        <button type="button" class="pick-location-btn" data-stop-index="${index}">Pick On Map</button>
        <span class="location-preview" id="locationPreview_${index}">No map point selected</span>
      </div>
      <div class="location-search-row">
        <input
          name="stopSearch_${index}"
          class="location-search-input"
          placeholder="Search place (e.g., Eiffel Tower, Paris)"
        />
        <button type="button" class="search-location-btn" data-stop-index="${index}">Search</button>
      </div>
      <select name="stopSearchResults_${index}" class="location-results" data-stop-index="${index}">
        <option value="">Search results will appear here</option>
      </select>
      <input name="stopLat_${index}" type="hidden" />
      <input name="stopLng_${index}" type="hidden" />
      <div class="grid-2">
        <label>Arrived At<input name="stopArrived_${index}" type="datetime-local" data-time-field="arrived" /></label>
        <label>Departed At<input name="stopDeparted_${index}" type="datetime-local" data-time-field="departed" /></label>
      </div>
      <label>Notes<textarea name="stopNotes_${index}"></textarea></label>
      <label>Stop Photos (optional, multiple allowed)
        <input name="stopPhoto_${index}" type="file" accept="image/*" multiple />
      </label>
    </div>
  `;
}

function addStop() {
  stopsContainer.insertAdjacentHTML('beforeend', stopCardTemplate(stopCount));
  stopCount += 1;
  refreshStopRoleLabels();
}

function refreshStopRoleLabels() {
  const cards = stopsContainer.querySelectorAll('.stop-card');
  cards.forEach((card, idx) => {
    const label = card.querySelector('.stop-role-label');
    if (!label) {
      return;
    }
    if (idx === 0) {
      label.textContent = 'Start Destination';
      const arrived = card.querySelector('[data-time-field="arrived"]');
      const departed = card.querySelector('[data-time-field="departed"]');
      if (arrived) {
        arrived.value = '';
        arrived.disabled = true;
        arrived.required = false;
      }
      if (departed) {
        departed.disabled = false;
        departed.required = true;
      }
      return;
    }
    if (idx === cards.length - 1) {
      label.textContent = 'End Destination';
      const arrived = card.querySelector('[data-time-field="arrived"]');
      const departed = card.querySelector('[data-time-field="departed"]');
      if (arrived) {
        arrived.disabled = false;
        arrived.required = true;
      }
      if (departed) {
        departed.value = '';
        departed.disabled = true;
        departed.required = false;
      }
      return;
    }
    label.textContent = `Stop #${idx + 1} (in-between)`;
    const arrived = card.querySelector('[data-time-field="arrived"]');
    const departed = card.querySelector('[data-time-field="departed"]');
    if (arrived) {
      arrived.disabled = false;
      arrived.required = false;
    }
    if (departed) {
      departed.disabled = false;
      departed.required = false;
    }
  });
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

function populateLocationResults(stopIndex, results) {
  const select = stopsContainer.querySelector(`[name="stopSearchResults_${stopIndex}"]`);
  if (!select) {
    return;
  }

  const options = ['<option value="">Choose a search result</option>'];
  results.forEach((item) => {
    const optionValue = `${item.lat},${item.lon}`;
    const label = item.display_name.replace(/"/g, '&quot;');
    options.push(`<option value="${optionValue}">${label}</option>`);
  });

  select.innerHTML = options.join('');
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function collectPayload(formData) {
  const companionsRaw = formData.get('companions') || '';

  const payload = {
    title: formData.get('title'),
    description: formData.get('description') || null,
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate') || null,
    transportMode: formData.get('transportMode') || null,
    routeSummary: formData.get('routeSummary') || null,
    companions: companionsRaw
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
    stops: []
  };

  for (let i = 0; i < stopCount; i += 1) {
    if (!formData.get(`stopName_${i}`)) {
      continue;
    }

    payload.stops.push({
      sourceIndex: i,
      name: formData.get(`stopName_${i}`),
      stopType: formData.get(`stopType_${i}`) || 'other',
      latitude: Number(formData.get(`stopLat_${i}`)),
      longitude: Number(formData.get(`stopLng_${i}`)),
      arrivedAt: toIso(formData.get(`stopArrived_${i}`)),
      departedAt: toIso(formData.get(`stopDeparted_${i}`)),
      notes: formData.get(`stopNotes_${i}`) || null
    });
  }

  return payload;
}

function markPickerActive(stopIndex) {
  document.querySelectorAll('.pick-location-btn').forEach((btn) => {
    const idx = Number(btn.dataset.stopIndex);
    btn.classList.toggle('active-pick', idx === stopIndex);
  });
}

function setStopLocation(stopIndex, latlng) {
  const latField = journeyForm.querySelector(`[name="stopLat_${stopIndex}"]`);
  const lngField = journeyForm.querySelector(`[name="stopLng_${stopIndex}"]`);
  const preview = document.getElementById(`locationPreview_${stopIndex}`);

  if (!latField || !lngField || !preview) {
    return;
  }

  latField.value = latlng.lat.toFixed(6);
  lngField.value = latlng.lng.toFixed(6);
  preview.textContent = `Selected: ${latField.value}, ${lngField.value}`;

  if (pickerMarkers.has(stopIndex)) {
    map.removeLayer(pickerMarkers.get(stopIndex));
  }

  const marker = L.circleMarker(latlng, {
    radius: 7,
    color: '#9b2226',
    fillColor: '#ca6702',
    fillOpacity: 0.9
  }).addTo(map);
  pickerMarkers.set(stopIndex, marker);
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

async function submitJourney(event) {
  event.preventDefault();

  const formData = new FormData(journeyForm);
  const payload = collectPayload(formData);

  if (payload.stops.length === 0) {
    statusMsg.textContent = 'Add at least two stops: start and end destinations.';
    return;
  }

  if (payload.stops.length < 2) {
    statusMsg.textContent = 'Start and end destinations are mandatory.';
    return;
  }

  const firstStop = payload.stops[0];
  const lastStop = payload.stops[payload.stops.length - 1];
  if (!firstStop.departedAt) {
    statusMsg.textContent = 'Start destination must include departure time.';
    return;
  }
  if (!lastStop.arrivedAt) {
    statusMsg.textContent = 'End destination must include arrival time.';
    return;
  }
  if (new Date(lastStop.arrivedAt).getTime() < new Date(firstStop.departedAt).getTime()) {
    statusMsg.textContent = 'End arrival time must be after start departure time.';
    return;
  }

  for (let i = 0; i < payload.stops.length; i += 1) {
    const stop = payload.stops[i];
    if (Number.isNaN(stop.latitude) || Number.isNaN(stop.longitude)) {
      statusMsg.textContent = `Stop ${i + 1} needs a map location.`;
      return;
    }
  }

  const requestData = new FormData();
  requestData.append('payload', JSON.stringify(payload));

  for (let i = 0; i < payload.stops.length; i += 1) {
    const sourceIndex = payload.stops[i].sourceIndex;
    const photos = formData.getAll(`stopPhoto_${sourceIndex}`).filter((file) => file && file.name);
    photos.forEach((photo) => requestData.append(`stopPhoto_${i}`, photo));
  }

  statusMsg.textContent = 'Saving...';

  const response = await fetch('/api/journeys', {
    method: 'POST',
    body: requestData
  });

  const result = await response.json();

  if (!response.ok) {
    statusMsg.textContent = result.error || 'Unable to save journey.';
    return;
  }

  statusMsg.textContent = 'Journey saved.';
  journeyForm.reset();
  stopsContainer.innerHTML = '';
  stopCount = 0;
  activeLocationStopIndex = null;

  pickerMarkers.forEach((marker) => map.removeLayer(marker));
  pickerMarkers.clear();

  addStop();
  addStop();
  markPickerActive(null);
  refreshStopRoleLabels();
  await loadTimeline();
}

async function loadTimeline() {
  const personQuery = personFilterInput.value.trim();
  const url = personQuery
    ? `/api/journeys?person=${encodeURIComponent(personQuery)}`
    : '/api/journeys';

  const listRes = await fetch(url);
  const journeys = await listRes.json();

  journeyLayers.forEach((layer) => map.removeLayer(layer));
  journeyLayers.length = 0;

  timelineEl.innerHTML = '';

  const boundsPoints = [];

  for (const journey of journeys) {
    const detailRes = await fetch(`/api/journeys/${journey.id}`);
    const detail = await detailRes.json();

    const points = detail.spots.map((s) => [s.latitude, s.longitude]);
    const routePoints = await buildMapRoutePoints(points, detail.transport_mode);
    if (routePoints.length > 0) {
      const line = L.polyline(routePoints, { color: '#ca6702', weight: 4 }).addTo(map);
      journeyLayers.push(line);
      routePoints.forEach((point) => boundsPoints.push(point));

      detail.spots.forEach((spot, idx) => {
        const marker = L.marker([spot.latitude, spot.longitude]).addTo(map);
        marker.bindPopup(`
          <strong>${spot.name}</strong><br />
          Type: ${spot.stop_type || 'other'}<br />
          Stop #${idx + 1}<br />
          Photos: ${spot.photos.length}
        `);
        journeyLayers.push(marker);
      });
    }

    const card = document.createElement('article');
    card.className = 'timeline-card';
    card.dataset.href = `/journey.html?id=${detail.id}`;
    card.innerHTML = `
      <h4>${detail.title}</h4>
      <p class="timeline-meta">${detail.start_date}${detail.end_date ? ` to ${detail.end_date}` : ''}</p>
      <p class="timeline-meta">Transport: ${detail.transport_mode || 'N/A'} | Duration: ${detail.total_duration_minutes || 'N/A'} mins</p>
      <p class="timeline-meta">People: ${detail.companions.join(', ') || 'Solo'}</p>
      <p>${detail.route_summary || ''}</p>
      <p class="timeline-meta">Start: ${detail.spots[0] ? detail.spots[0].name : 'N/A'} | End: ${detail.spots.length ? detail.spots[detail.spots.length - 1].name : 'N/A'}</p>
      <p><strong>Stops:</strong> ${detail.spots.map((s) => `${s.name} (${s.stop_type || 'other'})`).join(' -> ')}</p>
      <p class="timeline-meta">Click card for full journey details</p>
    `;
    timelineEl.appendChild(card);
  }

  if (boundsPoints.length) {
    map.fitBounds(boundsPoints, { padding: [20, 20] });
  }
}

map.on('click', (event) => {
  if (activeLocationStopIndex === null) {
    return;
  }

  setStopLocation(activeLocationStopIndex, event.latlng);
  activeLocationStopIndex = null;
  markPickerActive(null);
  statusMsg.textContent = 'Map location attached to stop.';
});

stopsContainer.addEventListener('click', (event) => {
  const button = event.target.closest('.pick-location-btn');
  if (button) {
    const stopIndex = Number(button.dataset.stopIndex);
    activeLocationStopIndex = stopIndex;
    markPickerActive(stopIndex);
    statusMsg.textContent = `Click on the map to set location for stop ${stopIndex + 1}.`;
    return;
  }

  const searchButton = event.target.closest('.search-location-btn');
  if (!searchButton) {
    return;
  }

  const stopIndex = Number(searchButton.dataset.stopIndex);
  const searchInput = stopsContainer.querySelector(`[name="stopSearch_${stopIndex}"]`);
  const query = searchInput ? searchInput.value.trim() : '';
  if (!query) {
    statusMsg.textContent = 'Type a place name before searching.';
    return;
  }

  statusMsg.textContent = 'Searching places...';
  searchPlace(query)
    .then((results) => {
      if (!results.length) {
        statusMsg.textContent = 'No place found for that search.';
        populateLocationResults(stopIndex, []);
        return;
      }
      populateLocationResults(stopIndex, results);
      statusMsg.textContent = `Found ${results.length} places. Choose one from dropdown.`;
    })
    .catch((error) => {
      statusMsg.textContent = error.message || 'Location search failed.';
    });
});

stopsContainer.addEventListener('change', (event) => {
  const select = event.target.closest('.location-results');
  if (!select) {
    return;
  }

  const stopIndex = Number(select.dataset.stopIndex);
  if (!select.value) {
    return;
  }

  const [lat, lng] = select.value.split(',').map((v) => Number(v));
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    statusMsg.textContent = 'Invalid location result selected.';
    return;
  }

  setStopLocation(stopIndex, { lat, lng });
  map.setView([lat, lng], 13);
  statusMsg.textContent = `Location set from search for stop ${stopIndex + 1}.`;
});

timelineEl.addEventListener('click', (event) => {
  const card = event.target.closest('.timeline-card');
  if (!card || !card.dataset.href) {
    return;
  }
  window.location.href = card.dataset.href;
});

personFilterInput.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    await loadTimeline();
  }
});

addStopBtn.addEventListener('click', addStop);
journeyForm.addEventListener('submit', submitJourney);

addStop();
addStop();
refreshStopRoleLabels();
loadTimeline();
