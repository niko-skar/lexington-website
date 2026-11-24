// The amenities in the 3D model of the amenity floor, as its list names them (penthouse-3d src/data/uamen.info.js), with the
// ids that /amenities#<id> opens on. Plain data (no browser code), so the Amenities page (server) and the model's box (browser)
// both read it.
export const AMENITY_SPOTS = [
  { id: "pool", name: "Swimming pool" },
  { id: "cafe", name: "Café" },
  { id: "gym", name: "Gym" },
  { id: "sauna", name: "Sauna" },
  { id: "jacuzzi", name: "Jacuzzi" },
  { id: "icebath", name: "Ice bath" },
  { id: "changing", name: "Changing rooms" },
  { id: "lobby", name: "Lift lobby" },
] as const;

// The website's amenities (Sanity documents) as the model names them: their photo and line go on the model's cards.
export const SPOT_OF_AMENITY: Record<string, string> = {
  "amenity-signature-swimming-pool": "pool",
  "amenity-signature-caf": "cafe",
  "amenity-signature-gym": "gym",
  "amenity-signature-sauna": "sauna",
  "amenity-signature-jacuzzi": "jacuzzi",
  "amenity-signature-ice-bath": "icebath",
};
