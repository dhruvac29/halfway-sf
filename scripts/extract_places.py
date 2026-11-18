#!/usr/bin/env python3
"""Build the small, browser-ready SF meeting-place extract from Overture places.

Run the command in README to download GeoJSONSeq with Overture's official CLI,
then pass that file to this script. Only the fields used by the UI are shipped.
"""

import json
import sys
from collections import Counter
from pathlib import Path


GROUPS = {
    "coffee": {"cafe", "coffee_shop", "tea_house", "bubble_tea_shop", "bakery", "dessert_shop"},
    "food": {"restaurant", "casual_eatery", "fast_food_restaurant", "food_court", "diner", "pizza_restaurant"},
    "drinks": {"bar", "pub", "brewery", "wine_bar", "cocktail_bar"},
    "outdoors": {"park", "garden", "public_garden", "playground", "plaza"},
    "culture": {"museum", "art_gallery", "library", "performing_arts_venue", "theater", "bookstore"},
}


def group_for(props):
    basic = props.get("basic_category") or ""
    taxonomy = props.get("taxonomy") or {}
    hierarchy = taxonomy.get("hierarchy") or []
    terms = set(hierarchy) | {basic, taxonomy.get("primary")}
    for group, categories in GROUPS.items():
        if terms & categories:
            return group
    return None


def primary_name(props):
    names = props.get("names") or {}
    return names.get("primary") or names.get("common", {}).get("en")


def extract(source: Path):
    found = {}
    counts = Counter()
    for line in source.open(encoding="utf-8"):
        if not line.strip():
            continue
        feature = json.loads(line)
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = coords[:2]
        if not (-122.52 <= lon <= -122.35 and 37.70 <= lat <= 37.83):
            continue
        name = primary_name(props)
        group = group_for(props)
        confidence = props.get("confidence")
        if not name or not group or (confidence is not None and confidence < 0.7):
            continue
        item = {
            "id": props.get("id") or feature.get("id"),
            "name": name,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "group": group,
            "category": (props.get("basic_category") or (props.get("taxonomy") or {}).get("primary") or "place").replace("_", " "),
            "subcategory": (props.get("taxonomy") or {}).get("primary") or "",
            "confidence": round(confidence, 3) if confidence is not None else None,
            "website": next((url for url in (props.get("websites") or []) if isinstance(url, str) and url.startswith(("https://", "http://"))), None),
        }
        key = (name.casefold(), round(lat, 4), round(lon, 4))
        old = found.get(key)
        if old is None or (confidence or 0) > old[0]:
            found[key] = (confidence or 0, item)
    places = [value[1] for value in found.values()]
    places.sort(key=lambda p: (p["group"], p["name"].casefold(), p["id"] or ""))
    for place in places:
        counts[place["group"]] += 1
    return places, counts


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python3 scripts/extract_places.py input.geojsonseq dist/places.json")
    places, counts = extract(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(json.dumps(places, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"total": len(places), "groups": counts}, indent=2))
