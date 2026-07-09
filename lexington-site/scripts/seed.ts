import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
const token = process.env.SANITY_API_TOKEN;

if (!projectId || !dataset || !token) {
  throw new Error(
    "Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_DATASET / SANITY_API_TOKEN in .env.local"
  );
}

const client = createClient({
  projectId,
  dataset,
  token,
  apiVersion: "2024-06-01",
  useCdn: false,
});

const imagesDir = path.join(__dirname, "seed-images");

async function uploadImage(filename: string) {
  const filePath = path.join(imagesDir, filename);
  const asset = await client.assets.upload("image", fs.createReadStream(filePath), {
    filename,
  });
  return asset._id;
}

type GalleryEntry = {
  file: string;
  alt: string;
  category: "exterior" | "interior" | "amenity" | "floorplan" | "family";
};

const galleryEntries: GalleryEntry[] = [
  { file: "hero-exterior-1.jpg", alt: "The Lexington exterior at dusk, Shiashie, East Legon", category: "exterior" },
  { file: "hero-exterior-2.jpg", alt: "The Lexington exterior", category: "exterior" },
  { file: "exterior-3.jpg", alt: "The Lexington exterior facade", category: "exterior" },
  { file: "exterior-4.jpg", alt: "The Lexington exterior at golden hour", category: "exterior" },
  { file: "exterior-5.jpg", alt: "The Lexington exterior view", category: "exterior" },
  { file: "interior-1.jpg", alt: "Interior detail at The Lexington", category: "interior" },
  { file: "interior-2.jpg", alt: "Living space interior at The Lexington", category: "interior" },
  { file: "interior-3.jpg", alt: "Interior detail at The Lexington", category: "interior" },
  { file: "interior-4.jpg", alt: "Rental-ready interior at The Lexington", category: "interior" },
  { file: "interior-5.jpg", alt: "Rooftop amenities at The Lexington", category: "amenity" },
  { file: "interior-6.jpg", alt: "Pool and rooftop amenity area", category: "amenity" },
  { file: "interior-7.jpg", alt: "Interior detail at The Lexington", category: "interior" },
  { file: "interior-8.jpg", alt: "Rooftop lounge area at The Lexington", category: "amenity" },
  { file: "interior-9.jpg", alt: "Interior detail at The Lexington", category: "interior" },
  { file: "gallery-1.jpg", alt: "The Lexington exterior close-up", category: "exterior" },
  { file: "gallery-2.jpg", alt: "Living room interior", category: "interior" },
  { file: "gallery-3.jpg", alt: "Interior detail", category: "interior" },
  { file: "gallery-4.jpg", alt: "Interior detail", category: "interior" },
  { file: "gallery-5.jpg", alt: "Living room detail", category: "interior" },
  { file: "gallery-6.jpg", alt: "Living space detail", category: "interior" },
  { file: "gallery-7.jpg", alt: "Bedroom interior", category: "interior" },
  { file: "gallery-8.jpg", alt: "Rooftop lounge with fire feature", category: "amenity" },
  { file: "gallery-9.jpg", alt: "Gym and fitness area", category: "amenity" },
  { file: "gallery-10.jpg", alt: "Rooftop terrace view", category: "amenity" },
  { file: "gallery-11.jpg", alt: "Rooftop lounge", category: "amenity" },
  { file: "gallery-12.jpg", alt: "Indoor pool and gym", category: "amenity" },
  { file: "gallery-13.jpg", alt: "Rooftop terrace", category: "amenity" },
  { file: "gallery-14.jpg", alt: "Dining and lounge area", category: "interior" },
  { file: "floorplan-sample.jpg", alt: "Sample floor plan drawing, The Lexington", category: "floorplan" },
  { file: "family-portrait.jpg", alt: "The Skarlatos family", category: "family" },
];

type UnitSeed = {
  unitNumber: string;
  floor: number;
  bedroomType: "One Bedroom" | "Two Bedroom" | "3BR Duplex Penthouse";
  areaSqm: number;
  priceUSD: number;
};

const units: UnitSeed[] = [
  { unitNumber: "101A", floor: 1, bedroomType: "One Bedroom", areaSqm: 79, priceUSD: 159000 },
  { unitNumber: "102B", floor: 1, bedroomType: "One Bedroom", areaSqm: 88, priceUSD: 176000 },
  { unitNumber: "103B", floor: 1, bedroomType: "One Bedroom", areaSqm: 69, priceUSD: 135000 },
  { unitNumber: "104B", floor: 1, bedroomType: "Two Bedroom", areaSqm: 137, priceUSD: 274000 },

  { unitNumber: "202A", floor: 2, bedroomType: "One Bedroom", areaSqm: 84, priceUSD: 175500 },
  { unitNumber: "203B", floor: 2, bedroomType: "One Bedroom", areaSqm: 76, priceUSD: 159000 },
  { unitNumber: "204B", floor: 2, bedroomType: "One Bedroom", areaSqm: 77, priceUSD: 161000 },
  { unitNumber: "205B", floor: 2, bedroomType: "Two Bedroom", areaSqm: 129, priceUSD: 271000 },
  { unitNumber: "201A", floor: 2, bedroomType: "Two Bedroom", areaSqm: 165, priceUSD: 346500 },

  { unitNumber: "301A", floor: 3, bedroomType: "Two Bedroom", areaSqm: 136, priceUSD: 300300 },
  { unitNumber: "302A", floor: 3, bedroomType: "Two Bedroom", areaSqm: 91, priceUSD: 199800 },
  { unitNumber: "303B", floor: 3, bedroomType: "Two Bedroom", areaSqm: 87, priceUSD: 191900 },
  { unitNumber: "304B", floor: 3, bedroomType: "Two Bedroom", areaSqm: 89, priceUSD: 195300 },
  { unitNumber: "305B", floor: 3, bedroomType: "Two Bedroom", areaSqm: 126, priceUSD: 276000 },

  { unitNumber: "402A", floor: 4, bedroomType: "One Bedroom", areaSqm: 80, priceUSD: 183000 },
  { unitNumber: "403B", floor: 4, bedroomType: "One Bedroom", areaSqm: 76, priceUSD: 175000 },
  { unitNumber: "404B", floor: 4, bedroomType: "One Bedroom", areaSqm: 70, priceUSD: 160000 },
  { unitNumber: "405B", floor: 4, bedroomType: "Two Bedroom", areaSqm: 138, priceUSD: 317000 },
  { unitNumber: "401A", floor: 4, bedroomType: "Two Bedroom", areaSqm: 149, priceUSD: 342700 },

  { unitNumber: "501A", floor: 5, bedroomType: "One Bedroom", areaSqm: 85, priceUSD: 212000 },
  { unitNumber: "502B", floor: 5, bedroomType: "One Bedroom", areaSqm: 88, priceUSD: 221000 },
  { unitNumber: "503B", floor: 5, bedroomType: "One Bedroom", areaSqm: 79, priceUSD: 198000 },

  { unitNumber: "PH1a", floor: 6, bedroomType: "3BR Duplex Penthouse", areaSqm: 327, priceUSD: 817500 },
  { unitNumber: "PH2b", floor: 6, bedroomType: "3BR Duplex Penthouse", areaSqm: 375, priceUSD: 937500 },
];

const rooftopAmenities = [
  "Private Resident's Rooftop Garden",
  "Swimming Pool",
  "Gym",
  "Sauna",
  "Jacuzzi",
  "Ice Bath",
  "Café",
];

const buildingFeatureAmenities = [
  "High-Speed Elevators",
  "Premium Kitchen Appliances",
  "Ultra-Fast Internet Connectivity",
  "Natural Stone Flooring",
  "Energy-Saving LED Spotlights",
  "CCTV & Fire Safety Systems",
  "Back-up Power Generator & Water",
  "Built-in Earthquake-Resistant Features",
  "Garbage Management Chutes",
  "On-site Boys' Quarters",
  "Storage Facilities",
];

const familyMembers = [
  {
    name: "Mikhail Skarlatos",
    years: "1922 – Present",
    bio: "Senior Executive at Doxiades & Associates for 60+ years, responsible for city-wide planning and development of Tema from the ground up in the 1960s.",
  },
  {
    name: "Leo Skarlatos",
    years: "1962 – Present",
    bio: "Designed the MTN Headquarters in Accra as CFO of MTN. Designed and financed the Silver Mountain Resort & Spa in Brasov, Romania.",
  },
  {
    name: "Niko Skarlatos",
    years: "1992 – Present",
    bio: "Developed multiple world-class showrooms in London, Accra, and Abidjan; completed a six-bedroom residence in Shiashie, East Legon.",
  },
];

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function seedUnits() {
  console.log(`Seeding ${units.length} units...`);
  for (const unit of units) {
    const id = `unit-${slugify(unit.unitNumber)}`;
    await client.createOrReplace({
      _id: id,
      _type: "unit",
      ...unit,
      status: "available",
    });
  }
}

async function seedAmenities() {
  const all: { name: string; category: "rooftop" | "building feature"; order: number }[] = [
    ...rooftopAmenities.map((name, i) => ({ name, category: "rooftop" as const, order: i })),
    ...buildingFeatureAmenities.map((name, i) => ({
      name,
      category: "building feature" as const,
      order: i,
    })),
  ];
  console.log(`Seeding ${all.length} amenities...`);
  for (const a of all) {
    const id = `amenity-${a.category === "rooftop" ? "rooftop" : "feature"}-${slugify(a.name)}`;
    await client.createOrReplace({ _id: id, _type: "amenity", ...a });
  }
}

async function seedFamilyMembers() {
  console.log(`Seeding ${familyMembers.length} family members...`);
  for (let i = 0; i < familyMembers.length; i++) {
    const m = familyMembers[i];
    const id = `family-${slugify(m.name)}`;
    await client.createOrReplace({ _id: id, _type: "familyMember", ...m, order: i });
  }
}

async function seedFinancingPlan() {
  console.log("Seeding financing plan...");
  await client.createOrReplace({
    _id: "financingPlan",
    _type: "financingPlan",
    selfFinanceRows: [
      { _key: "reservation", milestone: "Reservation", timeframe: "Day 1", option1: "$10,000", option2: "$10,000", upfrontPayment: "100%", discount: "12.5%" },
      { _key: "first", milestone: "1st Instalment", timeframe: "30 Days", option1: "20%", option2: "40%", upfrontPayment: "90%", discount: "11%" },
      { _key: "second", milestone: "2nd Instalment", timeframe: "4 Months", option1: "20%", option2: "—", upfrontPayment: "80%", discount: "9.5%" },
      { _key: "third", milestone: "3rd Instalment", timeframe: "8 Months", option1: "20%", option2: "—", upfrontPayment: "70%", discount: "8%" },
      { _key: "fourth", milestone: "4th Instalment", timeframe: "12 Months", option1: "20%", option2: "40%", upfrontPayment: "60%", discount: "6.5%" },
      { _key: "final", milestone: "Final Instalment", timeframe: "Completion", option1: "20%", option2: "20%", upfrontPayment: "50%", discount: "5%" },
    ],
    mortgageRows: [
      { _key: "reservation", milestone: "Reservation", timeframe: "Day 1", option1: "$10,000" },
      { _key: "downpayment", milestone: "Downpayment", timeframe: "30 Days", option1: "30%" },
      { _key: "final", milestone: "Final", timeframe: "Completion", option1: "70%" },
    ],
    buyToRent: {
      oneBedroomRange: "$1,300–$2,100/mo",
      twoBedroomRange: "$1,900–$2,900/mo",
      projectedYieldPct: 11,
    },
  });
}

async function seedGallery() {
  console.log(`Uploading and seeding ${galleryEntries.length} gallery images...`);
  for (let i = 0; i < galleryEntries.length; i++) {
    const entry = galleryEntries[i];
    const id = `gallery-${slugify(entry.file.replace(/\.[a-z]+$/, ""))}`;
    const assetId = await uploadImage(entry.file);
    await client.createOrReplace({
      _id: id,
      _type: "galleryImage",
      alt: entry.alt,
      category: entry.category,
      order: i,
      image: {
        _type: "image",
        asset: { _type: "reference", _ref: assetId },
      },
    });
    console.log(`  uploaded ${entry.file} -> ${id}`);
  }
}

async function main() {
  await seedUnits();
  await seedAmenities();
  await seedFamilyMembers();
  await seedFinancingPlan();
  await seedGallery();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
