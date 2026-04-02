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

let currentJourney = null;
let journeyLayers = [];
let addStopMarker = null;
const editMarkers = new Map();
let pickMode = null; // { type: 'add' } | { type: 'edit', index: number }
const LOCATION_SEARCH_DEBOUNCE_MS = 350;
const MIN_LOCATION_QUERY_LENGTH = 2;
let newStopSearchTimer = null;
let newStopSearchController = null;
const inlineSearchTimers = new Map();
const inlineSearchControllers = new Map();

function getJourneyId() {
  const params = new URLSearchParams(window.location.search);
  const id = (params.get('id') || '').trim();
  return id || null;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function toLocalInputValue(isoValue) {
  if (!isoValue) {
    return '';
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
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

async function searchPlace(query, signal) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    },
    signal
  });

  if (!response.ok) {
    throw new Error('Unable to search location right now.');
  }

  return response.json();
}

function renderSearchResults(selectEl, results) {
  const options = ['<option value="">Choose a search result</option>'];
  results.forEach((item) => {
    const optionValue = `${item.lat},${item.lon}`;
    const label = escapeHtml(item.display_name);
    options.push(`<option value="${optionValue}">${label}</option>`);
  });
  selectEl.innerHTML = options.join('');
}

function resetSearchResults(selectEl, message = 'Search results will appear here') {
  if (!selectEl) {
    return;
  }
  selectEl.innerHTML = `<option value="">${escapeHtml(message)}</option>`;
}

function cancelNewStopSearch() {
  if (newStopSearchTimer) {
    clearTimeout(newStopSearchTimer);
    newStopSearchTimer = null;
  }
  if (newStopSearchController) {
    newStopSearchController.abort();
    newStopSearchController = null;
  }
}

function cancelInlineSearch(stopIndex) {
  if (inlineSearchTimers.has(stopIndex)) {
    clearTimeout(inlineSearchTimers.get(stopIndex));
    inlineSearchTimers.delete(stopIndex);
  }
  if (inlineSearchControllers.has(stopIndex)) {
    inlineSearchControllers.get(stopIndex).abort();
    inlineSearchControllers.delete(stopIndex);
  }
}

function clearInlineSearchState() {
  inlineSearchTimers.forEach((timerId) => clearTimeout(timerId));
  inlineSearchTimers.clear();
  inlineSearchControllers.forEach((controller) => controller.abort());
  inlineSearchControllers.clear();
}

async function runNewStopSearch(query) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    cancelNewStopSearch();
    resetSearchResults(newStopSearchResults);
    return;
  }

  if (normalizedQuery.length < MIN_LOCATION_QUERY_LENGTH) {
    cancelNewStopSearch();
    resetSearchResults(newStopSearchResults, `Type at least ${MIN_LOCATION_QUERY_LENGTH} characters to search`);
    return;
  }

  if (newStopSearchController) {
    newStopSearchController.abort();
  }

  const controller = new AbortController();
  newStopSearchController = controller;
  insertStopStatus.textContent = 'Searching places...';

  try {
    const results = await searchPlace(normalizedQuery, controller.signal);
    if (newStopSearchController !== controller) {
      return;
    }

    if (!results.length) {
      renderSearchResults(newStopSearchResults, []);
      insertStopStatus.textContent = 'No place found for that search.';
      return;
    }

    renderSearchResults(newStopSearchResults, results);
    insertStopStatus.textContent = `Found ${results.length} places. Choose one from dropdown.`;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return;
    }
    insertStopStatus.textContent = error.message || 'Location search failed.';
  } finally {
    if (newStopSearchController === controller) {
      newStopSearchController = null;
    }
  }
}

function scheduleNewStopSearch(query) {
  if (newStopSearchTimer) {
    clearTimeout(newStopSearchTimer);
  }
  newStopSearchTimer = setTimeout(() => {
    newStopSearchTimer = null;
    runNewStopSearch(query);
  }, LOCATION_SEARCH_DEBOUNCE_MS);
}

async function runInlineStopSearch(stopIndex, query, resultsSelect, status) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    cancelInlineSearch(stopIndex);
    resetSearchResults(resultsSelect);
    if (status) {
      status.textContent = '';
    }
    return;
  }

  if (normalizedQuery.length < MIN_LOCATION_QUERY_LENGTH) {
    cancelInlineSearch(stopIndex);
    resetSearchResults(resultsSelect, `Type at least ${MIN_LOCATION_QUERY_LENGTH} characters to search`);
    if (status) {
      status.textContent = '';
    }
    return;
  }

  if (!resultsSelect) {
    return;
  }

  if (inlineSearchControllers.has(stopIndex)) {
    inlineSearchControllers.get(stopIndex).abort();
  }

  const controller = new AbortController();
  inlineSearchControllers.set(stopIndex, controller);

  if (status) {
    status.textContent = 'Searching places...';
  }

  try {
    const results = await searchPlace(normalizedQuery, controller.signal);
    if (inlineSearchControllers.get(stopIndex) !== controller) {
      return;
    }

    if (!document.body.contains(resultsSelect)) {
      return;
    }

    renderSearchResults(resultsSelect, results);
    if (status) {
      status.textContent = results.length
        ? `Found ${results.length} places. Choose one from dropdown.`
        : 'No place found for that search.';
    }
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return;
    }
    if (status) {
      status.textContent = error.message || 'Location search failed.';
    }
  } finally {
    if (inlineSearchControllers.get(stopIndex) === controller) {
      inlineSearchControllers.delete(stopIndex);
    }
  }
}

function scheduleInlineStopSearch(stopIndex, query, resultsSelect, status) {
  if (inlineSearchTimers.has(stopIndex)) {
    clearTimeout(inlineSearchTimers.get(stopIndex));
  }

  const timerId = setTimeout(() => {
    inlineSearchTimers.delete(stopIndex);
    runInlineStopSearch(stopIndex, query, resultsSelect, status);
  }, LOCATION_SEARCH_DEBOUNCE_MS);

  inlineSearchTimers.set(stopIndex, timerId);
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

function setInlineEditLocation(stopIndex, lat, lng) {
  const card = stopsDetail.querySelector(`[data-stop-index="${stopIndex}"]`);
  if (!card) {
    return;
  }

  const latField = card.querySelector('.inline-edit-lat');
  const lngField = card.querySelector('.inline-edit-lng');
  const preview = card.querySelector('.inline-edit-location-preview');
  if (!latField || !lngField || !preview) {
    return;
  }

  latField.value = Number(lat).toFixed(6);
  lngField.value = Number(lng).toFixed(6);
  preview.textContent = `Selected: ${latField.value}, ${lngField.value}`;

  if (editMarkers.has(stopIndex)) {
    map.removeLayer(editMarkers.get(stopIndex));
  }

  const marker = L.circleMarker([lat, lng], {
    radius: 7,
    color: '#1d3557',
    fillColor: '#457b9d',
    fillOpacity: 0.9
  }).addTo(map);
  editMarkers.set(stopIndex, marker);
}

function clearAllEditMarkers() {
  editMarkers.forEach((marker) => map.removeLayer(marker));
  editMarkers.clear();
}

function renderStopItem(stop, index, totalStops) {
  const isStart = index === 0;
  const isEnd = index === totalStops - 1;
  const role = isStart ? 'Start' : isEnd ? 'End' : 'In-between';
  const shortNote = stop.notes ? stop.notes : 'No notes';
  const photos = (stop.photos || [])
    .map((path, photoIndex) => `<img src="${path}" alt="${escapeHtml(stop.name)} photo ${photoIndex + 1}" class="stop-photo" />`)
    .join('');

  return `
    <article class="stop-item" data-stop-index="${index}">
      <div class="stop-item-head">
        <button type="button" class="toggle-stop-btn">Show</button>
        <div class="stop-item-summary">
          <h3>${index + 1}. ${escapeHtml(stop.name)}</h3>
          <p class="timeline-meta">${escapeHtml(shortNote)}</p>
        </div>
        <div class="stop-inline-actions">
          <button type="button" class="edit-stop-btn">Edit</button>
          <button type="button" class="danger-btn delete-stop-btn" ${isStart || isEnd ? 'disabled' : ''}>
            Delete
          </button>
        </div>
      </div>

      <div class="stop-item-body is-hidden">
        <p class="timeline-meta">Role: ${role} | Type: ${escapeHtml(stop.stop_type || 'other')}</p>
        <p class="timeline-meta">Location: ${stop.latitude}, ${stop.longitude}</p>
        <p class="timeline-meta">Arrived: ${stop.arrived_at || 'N/A'} | Departed: ${stop.departed_at || 'N/A'}</p>
        <div class="stop-photos-grid">${photos || '<p class="timeline-meta">No photos added.</p>'}</div>

        <form class="inline-edit-form is-hidden" data-stop-index="${index}">
          <p class="hint">${isStart ? 'Start stop: arrival is ignored, departure required.' : isEnd ? 'End stop: departure is ignored, arrival required.' : 'In-between stop: all fields editable.'}</p>
          <label>Stop Name<input class="inline-edit-name" value="${escapeHtml(stop.name)}" required /></label>
          <label>Stop Type
            <select class="inline-edit-type">
              <option value="restaurant" ${stop.stop_type === 'restaurant' ? 'selected' : ''}>Restaurant</option>
              <option value="loo_stop" ${stop.stop_type === 'loo_stop' ? 'selected' : ''}>Loo Stop</option>
              <option value="shopping_stop" ${stop.stop_type === 'shopping_stop' ? 'selected' : ''}>Shopping Stop</option>
              <option value="tourist_stop" ${stop.stop_type === 'tourist_stop' ? 'selected' : ''}>Tourist Stop</option>
              <option value="hotel_stop" ${stop.stop_type === 'hotel_stop' ? 'selected' : ''}>Hotel Stop</option>
              <option value="fuel_stop" ${stop.stop_type === 'fuel_stop' ? 'selected' : ''}>Fuel Stop</option>
              <option value="other" ${(!stop.stop_type || stop.stop_type === 'other') ? 'selected' : ''}>Other</option>
            </select>
          </label>

          <div class="location-row">
            <button type="button" class="pick-location-btn pick-inline-stop-location-btn" data-stop-index="${index}">Pick On Map</button>
            <span class="location-preview inline-edit-location-preview">Selected: ${Number(stop.latitude).toFixed(6)}, ${Number(stop.longitude).toFixed(6)}</span>
          </div>
          <div class="location-search-row">
            <input class="inline-location-search-input" placeholder="Search place" />
            <button type="button" class="search-location-btn search-inline-stop-location-btn">Search</button>
          </div>
          <select class="location-results inline-location-search-results">
            <option value="">Search results will appear here</option>
          </select>

          <input type="hidden" class="inline-edit-lat" value="${Number(stop.latitude).toFixed(6)}" />
          <input type="hidden" class="inline-edit-lng" value="${Number(stop.longitude).toFixed(6)}" />

          <div class="grid-2">
            <label>Arrived At
              <input class="inline-edit-arrived" type="datetime-local" value="${toLocalInputValue(stop.arrived_at)}" ${isStart ? 'disabled' : ''} ${isEnd ? 'required' : ''} />
            </label>
            <label>Departed At
              <input class="inline-edit-departed" type="datetime-local" value="${toLocalInputValue(stop.departed_at)}" ${isEnd ? 'disabled' : ''} ${isStart ? 'required' : ''} />
            </label>
          </div>
          <label>Notes<textarea class="inline-edit-notes">${escapeHtml(stop.notes || '')}</textarea></label>
          <label>Add Photos (optional, multiple)
            <input class="inline-edit-photos" type="file" accept="image/*" multiple />
          </label>

          <div class="grid-2">
            <button type="submit" class="primary">Save Changes</button>
            <button type="button" class="cancel-inline-edit-btn">Cancel</button>
          </div>
          <p class="status inline-edit-status"></p>
        </form>
      </div>
    </article>
  `;
}

function renderStopsList(stops) {
  stopsDetail.innerHTML = stops.map((stop, index) => renderStopItem(stop, index, stops.length)).join('');
}

function populateInsertPositionOptions(stops) {
  const options = ['<option value="">Select position</option>'];
  for (let i = 1; i < stops.length; i += 1) {
    options.push(`<option value="${i}">Before Stop #${i + 1}: ${escapeHtml(stops[i].name)}</option>`);
  }
  insertBeforeIndexSelect.innerHTML = options.join('');
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
      .bindPopup(`<strong>${escapeHtml(spot.name)}</strong><br/>Stop #${idx + 1}<br/>Photos: ${(spot.photos || []).length}`);
    journeyLayers.push(marker);
  });

  map.fitBounds(routePoints, { padding: [20, 20] });
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

  currentJourney = await res.json();

  journeyTitle.textContent = currentJourney.title;
  journeyMeta.textContent = `${currentJourney.start_date}${currentJourney.end_date ? ` to ${currentJourney.end_date}` : ''} | ${currentJourney.transport_mode || 'N/A'} | ${currentJourney.total_duration_minutes || 'N/A'} mins`;
  journeyPeople.textContent = `People: ${currentJourney.companions.join(', ') || 'Solo'}`;
  const startName = currentJourney.spots[0] ? currentJourney.spots[0].name : 'N/A';
  const endName = currentJourney.spots.length ? currentJourney.spots[currentJourney.spots.length - 1].name : 'N/A';
  journeyRoute.textContent = `${currentJourney.route_summary || ''} Start: ${startName} | End: ${endName}`;

  clearInlineSearchState();
  clearAllEditMarkers();
  await renderJourneyOnMap(currentJourney);
  renderStopsList(currentJourney.spots);
  populateInsertPositionOptions(currentJourney.spots);
}

map.on('click', (event) => {
  if (!pickMode) {
    return;
  }

  if (pickMode.type === 'add') {
    setNewStopLocation(event.latlng.lat, event.latlng.lng);
    pickMode = null;
    pickNewStopLocationBtn.classList.remove('active-pick');
    insertStopStatus.textContent = 'Location selected for new stop.';
    return;
  }

  if (pickMode.type === 'edit') {
    setInlineEditLocation(pickMode.index, event.latlng.lat, event.latlng.lng);
    pickMode = null;
    document.querySelectorAll('.pick-inline-stop-location-btn').forEach((btn) => btn.classList.remove('active-pick'));
  }
});

pickNewStopLocationBtn.addEventListener('click', () => {
  pickMode = { type: 'add' };
  pickNewStopLocationBtn.classList.add('active-pick');
  document.querySelectorAll('.pick-inline-stop-location-btn').forEach((btn) => btn.classList.remove('active-pick'));
  insertStopStatus.textContent = 'Click on the map to set the new stop location.';
});

searchNewStopBtn.addEventListener('click', () => {
  runNewStopSearch(newStopSearchInput.value);
});

newStopSearchInput.addEventListener('input', () => {
  const query = newStopSearchInput.value.trim();
  if (!query) {
    cancelNewStopSearch();
    resetSearchResults(newStopSearchResults);
    return;
  }
  scheduleNewStopSearch(query);
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
  insertStopStatus.textContent = 'Location selected from search.';
});

stopsDetail.addEventListener('click', async (event) => {
  const card = event.target.closest('.stop-item');
  if (!card) {
    return;
  }

  const stopIndex = Number(card.dataset.stopIndex);
  const body = card.querySelector('.stop-item-body');

  if (event.target.closest('.toggle-stop-btn')) {
    body.classList.toggle('is-hidden');
    const toggleBtn = card.querySelector('.toggle-stop-btn');
    toggleBtn.textContent = body.classList.contains('is-hidden') ? 'Show' : 'Hide';
    if (body.classList.contains('is-hidden')) {
      const form = card.querySelector('.inline-edit-form');
      if (form) {
        form.classList.add('is-hidden');
      }
    }
    return;
  }

  if (event.target.closest('.edit-stop-btn')) {
    body.classList.remove('is-hidden');
    const toggleBtn = card.querySelector('.toggle-stop-btn');
    toggleBtn.textContent = 'Hide';
    const form = card.querySelector('.inline-edit-form');
    if (form) {
      form.classList.remove('is-hidden');
    }
    const status = card.querySelector('.inline-edit-status');
    if (status) {
      status.textContent = `Current photos: ${(currentJourney?.spots?.[stopIndex]?.photos || []).length}. New uploads append.`;
    }
    return;
  }

  if (event.target.closest('.cancel-inline-edit-btn')) {
    const form = card.querySelector('.inline-edit-form');
    if (form) {
      form.classList.add('is-hidden');
    }
    cancelInlineSearch(stopIndex);
    const status = card.querySelector('.inline-edit-status');
    if (status) {
      status.textContent = '';
    }
    return;
  }

  if (event.target.closest('.pick-inline-stop-location-btn')) {
    pickMode = { type: 'edit', index: stopIndex };
    document.querySelectorAll('.pick-inline-stop-location-btn').forEach((btn) => btn.classList.remove('active-pick'));
    const btn = card.querySelector('.pick-inline-stop-location-btn');
    if (btn) {
      btn.classList.add('active-pick');
    }
    return;
  }

  if (event.target.closest('.search-inline-stop-location-btn')) {
    const queryInput = card.querySelector('.inline-location-search-input');
    const resultsSelect = card.querySelector('.inline-location-search-results');
    const status = card.querySelector('.inline-edit-status');
    const query = queryInput ? queryInput.value : '';
    runInlineStopSearch(stopIndex, query, resultsSelect, status);
    return;
  }

  if (event.target.closest('.delete-stop-btn')) {
    const lastIndex = currentJourney.spots.length - 1;
    if (stopIndex <= 0 || stopIndex >= lastIndex) {
      return;
    }

    const confirmed = window.confirm('Delete this stop? This cannot be undone.');
    if (!confirmed) {
      return;
    }

    const status = card.querySelector('.inline-edit-status');
    if (status) {
      status.textContent = 'Deleting stop...';
    }

    const journeyId = getJourneyId();
    const response = await fetch(`/api/journeys/${journeyId}/stops/${stopIndex}`, {
      method: 'DELETE'
    });
    const result = await response.json();

    if (!response.ok) {
      if (status) {
        status.textContent = result.error || 'Unable to delete stop.';
      }
      return;
    }

    await loadJourney();
  }
});

stopsDetail.addEventListener('input', (event) => {
  const queryInput = event.target.closest('.inline-location-search-input');
  if (!queryInput) {
    return;
  }

  const card = queryInput.closest('.stop-item');
  if (!card) {
    return;
  }

  const stopIndex = Number(card.dataset.stopIndex);
  if (!Number.isInteger(stopIndex)) {
    return;
  }

  const resultsSelect = card.querySelector('.inline-location-search-results');
  const status = card.querySelector('.inline-edit-status');
  const query = queryInput.value.trim();
  if (!query) {
    cancelInlineSearch(stopIndex);
    resetSearchResults(resultsSelect);
    if (status) {
      status.textContent = '';
    }
    return;
  }

  scheduleInlineStopSearch(stopIndex, query, resultsSelect, status);
});

stopsDetail.addEventListener('change', (event) => {
  const resultsSelect = event.target.closest('.inline-location-search-results');
  if (!resultsSelect) {
    return;
  }

  const card = event.target.closest('.stop-item');
  if (!card || !resultsSelect.value) {
    return;
  }

  const stopIndex = Number(card.dataset.stopIndex);
  const [lat, lng] = resultsSelect.value.split(',').map((v) => Number(v));
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return;
  }

  setInlineEditLocation(stopIndex, lat, lng);
});

stopsDetail.addEventListener('submit', async (event) => {
  const form = event.target.closest('.inline-edit-form');
  if (!form) {
    return;
  }

  event.preventDefault();

  const card = form.closest('.stop-item');
  if (!card || !currentJourney) {
    return;
  }

  const stopIndex = Number(card.dataset.stopIndex);
  const status = form.querySelector('.inline-edit-status');

  const name = form.querySelector('.inline-edit-name')?.value.trim();
  const stopType = form.querySelector('.inline-edit-type')?.value || 'other';
  const lat = Number(form.querySelector('.inline-edit-lat')?.value);
  const lng = Number(form.querySelector('.inline-edit-lng')?.value);
  const arrivedInput = form.querySelector('.inline-edit-arrived');
  const departedInput = form.querySelector('.inline-edit-departed');
  const notes = form.querySelector('.inline-edit-notes')?.value || null;
  const filesInput = form.querySelector('.inline-edit-photos');

  if (!name) {
    if (status) {
      status.textContent = 'Stop name is required.';
    }
    return;
  }

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    if (status) {
      status.textContent = 'Location is required.';
    }
    return;
  }

  const lastIndex = currentJourney.spots.length - 1;
  const arrivedAt = arrivedInput && !arrivedInput.disabled ? toIso(arrivedInput.value) : null;
  const departedAt = departedInput && !departedInput.disabled ? toIso(departedInput.value) : null;

  if (stopIndex === 0 && !departedAt) {
    if (status) {
      status.textContent = 'Start destination requires departure time.';
    }
    return;
  }

  if (stopIndex === lastIndex && !arrivedAt) {
    if (status) {
      status.textContent = 'End destination requires arrival time.';
    }
    return;
  }

  const payload = {
    stop: {
      name,
      stopType,
      latitude: lat,
      longitude: lng,
      arrivedAt,
      departedAt,
      notes
    }
  };

  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  Array.from(filesInput?.files || []).forEach((file) => {
    formData.append('stopPhoto', file);
  });

  if (status) {
    status.textContent = 'Saving changes...';
  }

  const journeyId = getJourneyId();
  const response = await fetch(`/api/journeys/${journeyId}/stops/${stopIndex}`, {
    method: 'PATCH',
    body: formData
  });
  const result = await response.json();

  if (!response.ok) {
    if (status) {
      status.textContent = result.error || 'Unable to update stop.';
    }
    return;
  }

  await loadJourney();
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
  cancelNewStopSearch();
  resetSearchResults(newStopSearchResults);
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
