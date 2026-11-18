const NEIGHBORHOODS = [
  ["Marina District", 37.8014, -122.4362],
  ["Mission Dolores", 37.7596, -122.4269],
  ["North Beach", 37.7997, -122.4090],
  ["Hayes Valley", 37.7766, -122.4241],
  ["SoMa", 37.7785, -122.4056],
  ["Noe Valley", 37.7502, -122.4337],
  ["Richmond District", 37.7801, -122.4706],
  ["Sunset District", 37.7556, -122.4941],
  ["Castro", 37.7609, -122.4350],
  ["Dogpatch", 37.7606, -122.3890],
  ["Chinatown", 37.7941, -122.4078],
  ["Golden Gate Park", 37.7694, -122.4862],
];

const TEMPLATES = {
  coffee_walk: { first: "coffee", second: "outdoors", firstCategories: ["coffee shop", "cafe", "casual eatery"], secondCategories: ["park", "garden", "national park"], maxHop: .65, title: "Coffee & a wander" },
  dinner_culture: { first: "food", second: "culture", firstCategories: ["restaurant"], secondCategories: ["art gallery", "museum"], maxHop: .5, title: "A bite & some art" },
  drinks_culture: { first: "drinks", second: "culture", firstCategories: ["bar", "brewery"], secondCategories: ["music venue", "performing arts venue", "theatre venue", "comedy club"], maxHop: .5, title: "Drinks & a show" },
  park_bite: { first: "outdoors", second: "food", firstCategories: ["park", "garden", "national park"], secondCategories: ["restaurant", "casual eatery"], maxHop: .6, title: "Fresh air & a bite" },
};

const state = {
  a: { name: NEIGHBORHOODS[0][0], lat: NEIGHBORHOODS[0][1], lon: NEIGHBORHOODS[0][2] },
  b: { name: NEIGHBORHOODS[1][0], lat: NEIGHBORHOODS[1][1], lon: NEIGHBORHOODS[1][2] },
  template: "coffee_walk", limit: 5, priority: "balanced", pairs: {},
  selected: null, requestedPlan: null, visiblePlans: [], picking: null, loaded: false,
};

const $ = id => document.getElementById(id);
const els = {
  a: $("start-a"), b: $("start-b"), limit: $("distance-limit"),
  templates: [...document.querySelectorAll(".template")],
  priorities: [...document.querySelectorAll("[data-priority]")],
  list: $("results-list"), summary: $("results-summary"), empty: $("empty-state"),
  hint: $("map-hint"), hintText: $("map-hint-text"), panel: document.querySelector(".map-panel"),
  fallback: $("map-fallback"), mapPlan: $("map-plan"), mapPlanNum: $("map-plan-num"),
  mapPlanTitle: $("map-plan-title"), mapPlanDetail: $("map-plan-detail"), share: $("share-button"),
};

let map = null;
let routeLayer = null;
let otherLayer = null;

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function miles(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function fmt(value) { return value < .05 ? "<0.1 mi" : `${value.toFixed(1)} mi`; }
function inArea(lat, lon) { return lat >= 37.70 && lat <= 37.83 && lon >= -122.52 && lon <= -122.35; }
function planKey(plan) { return `${plan.first.id}:${plan.second.id}`; }

function setOptions(select, name) {
  select.replaceChildren();
  NEIGHBORHOODS.forEach(([label]) => {
    const option = node("option", "", label); option.value = label; select.append(option);
  });
  const custom = node("option", "", "Custom map point"); custom.value = "custom"; select.append(custom);
  select.value = NEIGHBORHOODS.some(n => n[0] === name) ? name : "custom";
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const side of ["a", "b"]) {
    const raw = params.get(side);
    if (!raw) continue;
    const [lat, lon] = raw.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inArea(lat, lon)) continue;
    const preset = NEIGHBORHOODS.find(n => Math.abs(n[1] - lat) < .00005 && Math.abs(n[2] - lon) < .00005);
    state[side] = { name: preset ? preset[0] : "Custom map point", lat, lon };
  }
  if (TEMPLATES[params.get("kind")]) state.template = params.get("kind");
  if ([2, 3, 5, 8, 100].includes(Number(params.get("max")))) state.limit = Number(params.get("max"));
  if (["balanced", "shortest"].includes(params.get("focus"))) state.priority = params.get("focus");
  state.requestedPlan = params.get("plan");
}

function writeHash() {
  const params = new URLSearchParams({
    a: `${state.a.lat.toFixed(5)},${state.a.lon.toFixed(5)}`,
    b: `${state.b.lat.toFixed(5)},${state.b.lon.toFixed(5)}`,
    kind: state.template, max: String(state.limit), focus: state.priority,
  });
  if (state.selected) params.set("plan", state.selected);
  history.replaceState(null, "", `#${params.toString()}`);
}

function cell(lat, lon) { return `${Math.floor(lat / .01)},${Math.floor(lon / .01)}`; }
function buildPairs(places, template, nameCounts) {
  const organizationName = /\b(?:llc|inc\.?|corporation|enterprises|services|productions?|studios?)\b/i;
  const suitable = (place, group, categories) =>
    place.group === group && categories.includes(place.category) &&
    place.confidence >= .9 && (group === "outdoors" || Boolean(place.website)) &&
    !(group === "outdoors" && /\b(?:playground|dog park)\b/i.test(place.name)) &&
    !(group === "food" && place.subcategory === "restaurant") &&
    !organizationName.test(place.name) && !/[A-Za-z]{3,}\d{3,}/.test(place.name) &&
    (group === "outdoors" || nameCounts.get(place.name.toLowerCase()) <= 3);
  const firsts = places.filter(place => suitable(place, template.first, template.firstCategories));
  const seconds = places.filter(place => suitable(place, template.second, template.secondCategories));
  const cells = new Map();
  for (const place of seconds) {
    const key = cell(place.lat, place.lon);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(place);
  }
  const pairs = [];
  const latRange = template.maxHop / 69;
  const lonRange = template.maxHop / 54;
  for (const first of firsts) {
    const nearby = [];
    const minLat = Math.floor((first.lat - latRange) / .01), maxLat = Math.floor((first.lat + latRange) / .01);
    const minLon = Math.floor((first.lon - lonRange) / .01), maxLon = Math.floor((first.lon + lonRange) / .01);
    for (let x = minLat; x <= maxLat; x++) for (let y = minLon; y <= maxLon; y++) {
      for (const second of cells.get(`${x},${y}`) || []) {
        const hop = miles(first, second);
        if (hop >= .08 && hop <= template.maxHop) nearby.push({ first, second, hop });
      }
    }
    nearby.sort((a, b) => (a.hop + .2 * (1 - a.second.confidence)) - (b.hop + .2 * (1 - b.second.confidence)));
    pairs.push(...nearby.slice(0, 4));
  }
  return pairs;
}

function getRanked() {
  const pairs = state.pairs[state.template] || [];
  const weight = state.priority === "balanced" ? 1.6 : .15;
  return pairs.map(pair => {
    const da = miles(state.a, pair.first), db = miles(state.b, pair.first);
    const genericFood = pair.first.group === "food" && pair.first.subcategory === "restaurant" ? .22 : 0;
    const reliability = .5 * (1 - pair.first.confidence) + .3 * (1 - pair.second.confidence);
    return { ...pair, da, db, score: Math.max(da, db) + weight * Math.abs(da - db) + .55 * pair.hop + genericFood + reliability };
  }).filter(plan => Math.max(plan.da, plan.db) <= state.limit)
    .sort((a, b) => a.score - b.score || a.first.name.localeCompare(b.first.name));
}

function pickDiverse(ranked) {
  const chosen = [];
  for (const plan of ranked) {
    if (chosen.every(other => miles(plan.first, other.first) >= .35 && plan.second.id !== other.second.id)) chosen.push(plan);
    if (chosen.length === 3) return chosen;
  }
  for (const plan of ranked) {
    if (chosen.every(other => planKey(other) !== planKey(plan))) chosen.push(plan);
    if (chosen.length === 3) break;
  }
  return chosen;
}

function initMap() {
  if (!window.L) { els.fallback.hidden = false; return; }
  map = L.map("map", { zoomControl: false, scrollWheelZoom: false }).setView([37.78, -122.43], 12);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18,
  }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  otherLayer = L.layerGroup().addTo(map);
  map.on("click", event => {
    if (!state.picking) return;
    if (!inArea(event.latlng.lat, event.latlng.lng)) { els.hintText.textContent = "Pick a point within the SF search area"; return; }
    const side = state.picking;
    stopPicking();
    state[side] = { name: "Custom map point", lat: event.latlng.lat, lon: event.latlng.lng };
    setOptions(els[side], state[side].name);
    state.selected = null;
    render(); writeHash();
  });
}

function icon(label, className) {
  return L.divIcon({ className: "", html: `<div class="pin ${className}">${label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
}

function popup(title, subtitle) {
  const wrapper = node("div");
  wrapper.append(node("div", "popup-title", title), node("div", "popup-sub", subtitle));
  return wrapper;
}

function updateMap(plans, chosen) {
  if (!map) return;
  routeLayer.clearLayers(); otherLayer.clearLayers();
  for (const side of ["a", "b"]) {
    const start = state[side];
    L.marker([start.lat, start.lon], { icon: icon(side.toUpperCase(), `pin-${side}`), zIndexOffset: 900 })
      .addTo(routeLayer).bindPopup(popup(`${side.toUpperCase()} · ${start.name}`, "Starting point"));
  }
  const bounds = L.latLngBounds([[state.a.lat, state.a.lon], [state.b.lat, state.b.lon]]);
  plans.forEach(plan => {
    if (chosen && planKey(plan) === planKey(chosen)) return;
    L.circleMarker([plan.first.lat, plan.first.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#176c5f", fillOpacity: .75 })
      .addTo(otherLayer).bindPopup(popup(plan.first.name, "Another suggested plan"))
      .on("click", () => selectPlan(planKey(plan), true));
  });
  if (chosen) {
    L.polyline([[state.a.lat, state.a.lon], [chosen.first.lat, chosen.first.lon]], { color: "#e47757", weight: 2, opacity: .75, dashArray: "6 7" }).addTo(routeLayer);
    L.polyline([[state.b.lat, state.b.lon], [chosen.first.lat, chosen.first.lon]], { color: "#4d80a7", weight: 2, opacity: .75, dashArray: "6 7" }).addTo(routeLayer);
    L.polyline([[chosen.first.lat, chosen.first.lon], [chosen.second.lat, chosen.second.lon]], { color: "#176c5f", weight: 4, opacity: .8 }).addTo(routeLayer);
    L.marker([chosen.first.lat, chosen.first.lon], { icon: icon("1", "pin-stop"), zIndexOffset: 1100 }).addTo(routeLayer).bindPopup(popup(chosen.first.name, "Meet here · stop 1"));
    L.marker([chosen.second.lat, chosen.second.lon], { icon: icon("2", "pin-stop second"), zIndexOffset: 1100 }).addTo(routeLayer).bindPopup(popup(chosen.second.name, "Then go here · stop 2"));
    bounds.extend([chosen.first.lat, chosen.first.lon]).extend([chosen.second.lat, chosen.second.lon]);
  }
  map.fitBounds(bounds.pad(.22), { maxZoom: 13, animate: false });
  setTimeout(() => map.invalidateSize(), 0);
}

function stopPicking() {
  state.picking = null; els.hint.hidden = true; els.panel.classList.remove("picking");
  document.querySelectorAll(".map-pick").forEach(button => button.classList.remove("active"));
}

function selectPlan(key, fromMap = false) {
  state.selected = key;
  render(); writeHash();
  if (window.innerWidth < 851 && !fromMap) els.panel.scrollIntoView({ block: "center", behavior: "smooth" });
  if (fromMap) document.querySelector(`.plan-card.selected`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function mapsLink(place) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.lat},${place.lon}`)}`;
}

function resultCard(plan, index) {
  const article = node("article", "plan-card");
  article.dataset.key = planKey(plan);
  if (planKey(plan) === state.selected) article.classList.add("selected");
  const button = node("button", "plan-select"); button.type = "button";
  button.setAttribute("aria-label", `Show plan ${index + 1}: ${plan.first.name}, then ${plan.second.name}`);
  button.setAttribute("aria-pressed", String(planKey(plan) === state.selected));
  const top = node("div", "plan-top");
  const difference = Math.abs(plan.da - plan.db);
  const tag = difference < .16 ? "ALMOST EVEN" : plan.hop < .16 ? "EASY SECOND STOP" : "A GOOD ROUTE";
  top.append(node("span", "plan-number", `PLAN ${String(index + 1).padStart(2, "0")}`), node("span", "plan-tag", tag));
  const stops = node("div", "plan-stops");
  const rail = node("div", "stop-rail"); rail.append(node("i", "", "1"), node("i", "", "2"));
  const first = node("div", "stop-block"); first.append(node("small", "", "MEET AT"), node("strong", "", plan.first.name));
  const second = node("div", "stop-block"); second.append(node("small", "", "THEN HEAD TO"), node("strong", "", plan.second.name));
  stops.append(rail, first, second); button.append(top, stops);
  button.addEventListener("click", () => selectPlan(planKey(plan)));
  const metrics = node("div", "plan-metrics");
  for (const [label, value, cls] of [["A", plan.da, "metric-a"], ["B", plan.db, "metric-b"], ["Stops", plan.hop, "metric-hop"]]) {
    const metric = node("span", `metric ${cls}`); metric.append(node("i"), document.createTextNode(`${label} · ${fmt(value)}`)); metrics.append(metric);
  }
  const actions = node("div", "plan-actions");
  for (const [label, place] of [["Stop 1 ↗", plan.first], ["Stop 2 ↗", plan.second]]) {
    const link = node("a", "", label); link.href = mapsLink(place); link.target = "_blank"; link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `Open ${place.name} in Google Maps`); actions.append(link);
  }
  article.append(button, metrics, actions);
  return article;
}

function render() {
  els.templates.forEach(button => { const active = button.dataset.template === state.template; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
  els.priorities.forEach(button => { const active = button.dataset.priority === state.priority; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
  els.limit.value = String(state.limit);
  if (!state.loaded) { els.summary.textContent = "Finding your plans in Overture Maps data…"; updateMap([], null); return; }
  const ranked = getRanked();
  const plans = pickDiverse(ranked);
  state.visiblePlans = plans;
  const requested = state.requestedPlan && plans.find(p => planKey(p) === state.requestedPlan);
  if (requested) { state.selected = planKey(requested); state.requestedPlan = null; }
  if (!plans.some(plan => planKey(plan) === state.selected)) state.selected = plans[0] ? planKey(plans[0]) : null;
  const chosen = plans.find(plan => planKey(plan) === state.selected) || null;
  els.list.replaceChildren(...plans.map(resultCard));
  els.empty.hidden = ranked.length !== 0;
  const distance = state.limit === 100 ? "the area" : `${state.limit} miles of both starts`;
  els.summary.textContent = ranked.length
    ? `${ranked.length.toLocaleString()} possible two-stop pairings within ${distance}. Here are three distinct routes, ranked for ${state.priority === "balanced" ? "a fair split" : "a shorter trip"}.`
    : `No ${TEMPLATES[state.template].title.toLowerCase()} plans within ${distance}.`;
  if (chosen) {
    els.mapPlan.hidden = false;
    els.mapPlanNum.textContent = `/ PLAN ${String(plans.indexOf(chosen) + 1).padStart(2, "0")}`;
    els.mapPlanTitle.textContent = `${chosen.first.name} → ${chosen.second.name}`;
    els.mapPlanDetail.textContent = `A ${fmt(chosen.da)} · B ${fmt(chosen.db)} · stops ${fmt(chosen.hop)} apart`;
  } else els.mapPlan.hidden = true;
  updateMap(plans, chosen);
}

readHash();
setOptions(els.a, state.a.name); setOptions(els.b, state.b.name);
initMap(); render(); writeHash();

for (const side of ["a", "b"]) {
  els[side].addEventListener("change", event => {
    const preset = NEIGHBORHOODS.find(n => n[0] === event.target.value);
    if (!preset) {
      if (!map) return;
      state.picking = side; els.hintText.textContent = `Click the map to place ${side.toUpperCase()}`;
      els.hint.hidden = false; els.panel.classList.add("picking");
      if (window.innerWidth < 851) els.panel.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    state[side] = { name: preset[0], lat: preset[1], lon: preset[2] };
    state.selected = null; render(); writeHash();
  });
}
document.querySelectorAll(".map-pick").forEach(button => button.addEventListener("click", () => {
  if (!map) return;
  const side = button.dataset.pick;
  if (state.picking === side) { stopPicking(); return; }
  stopPicking(); state.picking = side; button.classList.add("active");
  els.hintText.textContent = `Click the map to place ${side.toUpperCase()}`;
  els.hint.hidden = false; els.panel.classList.add("picking");
  if (window.innerWidth < 851) els.panel.scrollIntoView({ block: "center", behavior: "smooth" });
}));
$("cancel-pick").addEventListener("click", stopPicking);
els.templates.forEach(button => button.addEventListener("click", () => { state.template = button.dataset.template; state.selected = null; render(); writeHash(); }));
els.priorities.forEach(button => button.addEventListener("click", () => { state.priority = button.dataset.priority; state.selected = null; render(); writeHash(); }));
els.limit.addEventListener("change", () => { state.limit = Number(els.limit.value); state.selected = null; render(); writeHash(); });
els.share.addEventListener("click", async () => {
  writeHash();
  try { await navigator.clipboard.writeText(location.href); els.share.textContent = "✓ Copied"; }
  catch { els.share.textContent = "Link in address bar"; }
  setTimeout(() => { els.share.textContent = "↗ Share"; }, 2400);
});
window.addEventListener("hashchange", () => { readHash(); setOptions(els.a, state.a.name); setOptions(els.b, state.b.name); render(); });

fetch("./places.json")
  .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then(places => {
    const nameCounts = new Map();
    for (const place of places) nameCounts.set(place.name.toLowerCase(), (nameCounts.get(place.name.toLowerCase()) || 0) + 1);
    for (const [key, template] of Object.entries(TEMPLATES)) state.pairs[key] = buildPairs(places, template, nameCounts);
    state.loaded = true; render(); writeHash();
  })
  .catch(() => { els.summary.textContent = "Place data did not load. Refresh the page to try again."; });
