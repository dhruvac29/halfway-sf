# Halfway SF

**One-sentence pitch:** Halfway turns two San Francisco starting points into a fair, two-stop outing—somewhere to meet, followed by something nearby to do together—using real places from Overture Maps.

## Why this product

"Where should we meet?" often becomes a negotiation about travel time, then another search for something to do. A midpoint alone does not make a plan. Halfway combines the two decisions and shows the trade-offs: how far each person travels, how close the second stop is, and why three different options made the shortlist.

## What you can do

1. Choose two neighborhoods or click precise starting points on the map.
2. Choose a kind of outing: coffee and a wander, a bite and some art, drinks and a show, or fresh air and a bite.
3. Set a maximum trip to the first stop and choose whether to favor a fair split or a shorter trip.
4. Compare three geographically distinct plans, inspect each on the map, open either stop in Google Maps, and share the whole search with a URL.

No account, API key, server database, or geolocation permission is required.

## How it works

The browser loads a 9,443-place San Francisco extract from Overture's places theme. A spatial grid finds compatible second stops near each potential first stop. Each place must match the template's visitable categories and have a high Overture confidence score; non-park venues also need a source website. Repeated chain names and obvious organization names are excluded from first-stop suggestions. Plans are ranked by the farther person's straight-line distance to stop 1, the imbalance between the two travelers, the distance between stops, and a small record-quality adjustment. A geographic spacing rule gives the shortlist variety.

The search is entirely local in the browser. The URL hash stores the two starts, outing type, distance limit, ranking preference, and selected plan.

## Data and provenance

- Source: [Overture Maps places](https://docs.overturemaps.org/guides/places/), downloaded on 2026-11-17 using the [official Python client](https://docs.overturemaps.org/getting-data/overturemaps-py/).
- Bounding box: `-122.52,37.70,-122.35,37.83` (San Francisco area).
- The raw download contained 75,916 records. The checked-in [`dist/places.json`](dist/places.json) contains 9,443 deduplicated places across five broad groups. The extractor keeps only IDs, names, coordinates, categories, confidence, and a source website.
- The extract uses confidence ≥ 0.7 when present; the planner uses confidence ≥ 0.9 for its suggestions. The higher threshold is a reliability filter, **not** a rating of the experience.
- The data-extraction script is [`scripts/extract_places.py`](scripts/extract_places.py). See [Overture's attribution and licensing information](https://docs.overturemaps.org/attribution/) for source licenses. Basemap tiles are © OpenStreetMap contributors.

To regenerate the extract (Python 3 and `uv` required):

```bash
uvx overturemaps download \
  --bbox=-122.52,37.70,-122.35,37.83 \
  -f geojsonseq --type=place -o sf_places.geojsonseq
python3 scripts/extract_places.py sf_places.geojsonseq dist/places.json
```

The official CLI targets the latest release, so later runs may produce different counts. The checked-in file is the snapshot used by the deployment.

## Run and deploy

```bash
python3 -m http.server 8765 --directory dist
```

Open `http://localhost:8765`. The frontend is plain HTML, CSS, and JavaScript; Leaflet provides the map. No build is required.

For Render's free static-site tier, connect this repository, choose **Static Site**, set the build command to `test -f dist/index.html && test -f dist/places.json`, and set the publish directory to `dist`. The same settings are recorded in [`render.yaml`](render.yaml).

## Deliberate trade-offs and cuts

- **Honest distance:** All distances are straight-line estimates, not walking or transit travel times. The next version should use a pedestrian routing graph for actual trip comparison.
- **No invented availability:** Overture does not provide dependable current opening hours or event schedules. The UI asks people to verify hours, access, and directions before leaving. This especially matters for performance venues.
- **Snapshot over live API:** The compact checked-in extract makes discovery fast and predictable without a backend. It requires manual refreshes as places change.
- **Geographic variety over reviews:** Overture does not provide ratings or sentiment. Suggestions are based on place type, record confidence, and geometry; the app does not pretend to know whether a venue is good.
- **San Francisco area, not a city polygon:** The extract uses a bounding box, so a few edge locations can lie outside municipal boundaries.

## Stack

Static HTML/CSS/JavaScript, Leaflet, OpenStreetMap tiles, Overture Maps places, Python standard-library extraction script, Render static hosting.
