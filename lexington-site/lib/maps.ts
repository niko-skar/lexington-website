const LEXINGTON_MAP_URL = "https://maps.app.goo.gl/uJrGXZyWzEhxBKRD6";

// Resolved from the office's Google Maps pin (maps.app.goo.gl/uJrGXZyWzEhxBKRD6)
// so any marker we place matches exactly where that link points.
export const LEXINGTON_COORDS = { lat: 5.63276, lng: -0.1754212 };

export function googleMapsUrl() {
  return LEXINGTON_MAP_URL;
}
