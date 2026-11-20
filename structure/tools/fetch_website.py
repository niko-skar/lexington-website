"""Fetch the homes as the live website shows them (the public Sanity dataset, read without a key) into
structure/model/website.json, for the 3D model's architecture layer.

    python3 structure/tools/fetch_website.py
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT = "2p1ef4hj"
DATASET = "production"
OUT = Path(__file__).resolve().parents[1] / "model" / "website.json"
QUERY = """{
  "units": *[_type == "unit"] | order(floor asc, unitNumber asc) {
    unitNumber, floor, bedroomType, areaSqm, balconySqm, terraceSqm, priceUSD, status, notes
  },
  "locationPlans": *[_type == "unitLocationPlan"] { floor, units },
  "amenities": *[_type == "amenity"] { name, category }
}"""


def main():
    url = f"https://{PROJECT}.api.sanity.io/v2021-10-21/data/query/{DATASET}?query=" + urllib.parse.quote(QUERY)
    with urllib.request.urlopen(url, timeout=30) as r:
        data = json.load(r)["result"]
    data["fetched"] = time.strftime("%Y-%m-%d %H:%M")
    OUT.write_text(json.dumps(data, indent=1))
    print(f"{len(data['units'])} units, {len(data['locationPlans'])} location plans -> {OUT}")


if __name__ == "__main__":
    main()
