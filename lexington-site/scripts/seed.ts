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
  id: string;
  file: string;
  alt: string;
  category: "exterior" | "interior" | "amenity" | "floorplan" | "family";
  // Set when the file behind an existing id was replaced (e.g. a mislabeled
  // source image) — forces a fresh upload instead of reusing the old asset.
  forceReupload?: boolean;
};

// Re-curated from a visual audit of every source file — several of the
// originally "curated" images turned out to be mislabeled or entirely
// unrelated stock photos (a Google Maps screenshot, London/Athens/Accra
// skylines). Broken ones were removed or replaced; real-but-miscategorized
// ones were relabeled to match what they actually show.
const galleryEntries: GalleryEntry[] = [
  { id: "hero-exterior-1", file: "hero-exterior-1.png", alt: "The Lexington exterior, Shiashie, East Legon", category: "exterior" },
  { id: "hero-exterior-2", file: "hero-exterior-2.jpg", alt: "The Lexington exterior", category: "exterior" },
  { id: "exterior-3", file: "exterior-3.jpg", alt: "The Lexington exterior facade", category: "exterior" },
  { id: "exterior-4", file: "exterior-4.jpg", alt: "The Lexington exterior at golden hour", category: "exterior" },
  { id: "exterior-5", file: "exterior-5.jpg", alt: "The Lexington exterior view", category: "exterior" },
  { id: "gallery-1", file: "gallery-1.jpg", alt: "The Lexington exterior close-up", category: "exterior" },

  { id: "interior-6", file: "interior-6.jpg", alt: "Living room interior", category: "interior" },
  { id: "gallery-6", file: "gallery-6.jpg", alt: "Penthouse living, dining and kitchen area", category: "interior" },
  { id: "interior-5", file: "interior-5.jpg", alt: "Living room interior", category: "interior" },
  { id: "gallery-2", file: "gallery-2.jpg", alt: "Bedroom interior", category: "interior" },
  { id: "gallery-4", file: "gallery-4.jpg", alt: "Open-plan dining and kitchen area", category: "interior" },
  { id: "gallery-7", file: "gallery-7.jpg", alt: "Bedroom interior", category: "interior" },

  { id: "interior-1", file: "interior-1.jpg", alt: "Indoor pool and gym area", category: "amenity" },
  { id: "interior-2", file: "interior-2.jpg", alt: "Indoor pool and gym area", category: "amenity" },
  { id: "interior-3", file: "interior-3.jpg", alt: "Jacuzzi and fitness area", category: "amenity" },
  { id: "interior-4", file: "interior-4.jpg", alt: "Jacuzzi and fitness area", category: "amenity" },
  { id: "gallery-9", file: "gallery-9.jpg", alt: "Rooftop lounge with fire feature", category: "amenity" },
  { id: "gallery-10", file: "gallery-10.jpg", alt: "Rooftop terrace view", category: "amenity" },
  { id: "gallery-11", file: "gallery-11.jpg", alt: "Gym and fitness area", category: "amenity" },
  { id: "gallery-12", file: "gallery-12.jpg", alt: "Indoor pool and gym", category: "amenity" },
  { id: "gallery-13", file: "gallery-13.jpg", alt: "Café and lounge terrace", category: "amenity" },
  { id: "gallery-14", file: "gallery-14.jpg", alt: "Pool deck", category: "amenity" },

  { id: "floorplan-one-bedroom", file: "floorplan-one-bedroom.png", alt: "Sample one-bedroom floor plan", category: "floorplan" },
  { id: "floorplan-two-bedroom", file: "floorplan-two-bedroom.png", alt: "Sample two-bedroom floor plan", category: "floorplan" },
  // The 3BR duplex penthouses span two levels — lower floor (living areas)
  // plus the upper/rooftop floor — so two plans are shown per unit, not one.
  { id: "floorplan-duplex-lower", file: "floorplan-duplex-lower.png", alt: "Sample duplex penthouse floor plan — lower floor", category: "floorplan" },
  { id: "floorplan-duplex-upper", file: "floorplan-duplex-upper.png", alt: "Sample duplex penthouse floor plan — upper floor (rooftop level)", category: "floorplan" },
];

// Docs from the old (broken/duplicate) curation that no longer have a
// corresponding entry above — deleted so they don't linger in the dataset.
const STALE_GALLERY_IDS = [
  "gallery-family-portrait",
  "gallery-floorplan-sample",
  "gallery-interior-7",
  "gallery-interior-8",
  "gallery-interior-9",
  "gallery-gallery-3",
  "gallery-gallery-5",
  "gallery-gallery-8",
  "gallery-floorplan-duplex-penthouse",
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

// Only the Garden is confirmed rooftop in the brochure; the rest are
// headline "World Class Amenities" without a stated floor location.
const rooftopAmenities = ["Private Resident's Rooftop Garden"];

const signatureAmenities = [
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
    photoFile: "family-mikhail.jpg",
  },
  {
    name: "Leo Skarlatos",
    years: "1962 – Present",
    bio: "Designed the MTN Headquarters in Accra as CFO of MTN. Designed and financed the Silver Mountain Resort & Spa in Brasov, Romania.",
    photoFile: "family-leo.jpg",
  },
  {
    name: "Niko Skarlatos",
    years: "1992 – Present",
    bio: "Developed multiple world-class showrooms in London, Accra, and Abidjan; completed a six-bedroom residence in Shiashie, East Legon.",
    photoFile: "family-niko.jpg",
    // Source photo is a tall portrait with his face near the top — a
    // default center-crop to a square/4:5 thumbnail cuts his head off.
    photoHotspot: { x: 0.5, y: 0.17, width: 0.55, height: 0.3 },
  },
];

// Each floor's brochure diagram splits its units across one or two
// images (not every unit fits in a single render) — floors 3 and 5 are
// the exception, where one image already covers every unit.
const unitLocationPlans = [
  { id: "floor1-a", floor: 1, units: ["101A", "102B", "103B"], file: "location-floor1-a.png" },
  { id: "floor1-b", floor: 1, units: ["104B"], file: "location-floor1-b.png" },
  { id: "floor2-a", floor: 2, units: ["202A", "203B", "204B"], file: "location-floor2-a.png" },
  { id: "floor2-b", floor: 2, units: ["201A", "205B"], file: "location-floor2-b.png" },
  { id: "floor3", floor: 3, units: ["301A", "302A", "303B", "304B", "305B"], file: "location-floor3.png" },
  { id: "floor4-a", floor: 4, units: ["402A", "403B", "404B"], file: "location-floor4-a.png" },
  { id: "floor4-b", floor: 4, units: ["401A", "405B"], file: "location-floor4-b.png" },
  { id: "floor5", floor: 5, units: ["501A", "502B", "503B"], file: "location-floor5.png" },
];

// Real site photos, not brochure renders. No EXIF/capture dates were
// available, so these are ordered and staged from a visual read of each
// photo (excavation depth, rebar vs. poured concrete, etc.) rather than
// timestamps. Construction hasn't reached upper floors yet — only the
// first four stages exist so far.
const constructionUpdates = [
  { file: "progress-01-groundbreaking.jpg", stage: "Groundbreaking", alt: "Niko and Leo Skarlatos breaking ground on The Lexington" },

  { file: "progress-02-earthworks-excavation.jpg", stage: "Earthworks", alt: "Excavator digging the foundation pit" },
  { file: "progress-03-earthworks-site-clearance.jpg", stage: "Earthworks", alt: "Site clearance and earth-moving equipment on site" },
  { file: "progress-04-earthworks-trench.jpg", stage: "Earthworks", alt: "Excavator digging the foundation trench" },
  { file: "progress-05-earthworks-hardcore.jpg", stage: "Earthworks", alt: "Excavator laying hardcore stone base in the foundation trench" },
  { file: "progress-06-earthworks-trench-wide.jpg", stage: "Earthworks", alt: "Wide view of the foundation trench excavation" },

  { file: "progress-07-foundation-rebar-mat.jpg", stage: "Foundation", alt: "Close-up of the foundation slab rebar mat" },
  { file: "progress-08-foundation-column-cages.jpg", stage: "Foundation", alt: "Foundation column reinforcement cages in the excavated pit" },
  { file: "progress-09-foundation-slab-rebar.jpg", stage: "Foundation", alt: "Workers tying foundation slab reinforcement and formwork" },
  { file: "progress-10-foundation-slab-rebar-wide.jpg", stage: "Foundation", alt: "Foundation slab rebar mat spanning the building footprint" },
  { file: "progress-11-foundation-slab-rebar-full.jpg", stage: "Foundation", alt: "Full-width view of the foundation reinforcement" },
  { file: "progress-12-foundation-grounding-detail.jpg", stage: "Foundation", alt: "Electrical grounding strap detail within the foundation rebar" },
  { file: "progress-13-foundation-hardcore-fill.jpg", stage: "Foundation", alt: "Excavator placing hardcore fill for the foundation base" },
  { file: "progress-14-foundation-slab-prep.jpg", stage: "Foundation", alt: "Foundation slab preparation alongside the site boundary wall" },
  { file: "progress-15-foundation-site-visit.jpg", stage: "Foundation", alt: "Niko Skarlatos on site during the foundation stage" },

  { file: "progress-16-concrete-pour-night.jpg", stage: "Concrete Pour", alt: "Night-time concrete pour with pump truck" },
  { file: "progress-17-concrete-pour-day.jpg", stage: "Concrete Pour", alt: "Daytime concrete pour with the site's tower crane in the background" },
  { file: "progress-18-concrete-pour-wide.jpg", stage: "Concrete Pour", alt: "Multiple concrete pump trucks pouring the ground floor slab" },

  { file: "progress-19-ground-floor-columns.jpg", stage: "Ground Floor Structure", alt: "Workers pouring concrete into ground floor column formwork" },
  { file: "progress-20-ground-floor-columns-detail.jpg", stage: "Ground Floor Structure", alt: "Workers on the ground floor column formwork" },
  { file: "progress-21-ground-floor-column-formwork.jpg", stage: "Ground Floor Structure", alt: "Ground floor column reinforcement and formwork" },
  { file: "progress-22-ground-floor-column-formwork-2.jpg", stage: "Ground Floor Structure", alt: "Ground floor column cage ready for concrete" },
  { file: "progress-23-ground-floor-rebar-cage.jpg", stage: "Ground Floor Structure", alt: "Close-up of a tied ground floor column reinforcement cage" },
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

const AMENITY_ID_PREFIX: Record<string, string> = {
  rooftop: "rooftop",
  signature: "signature",
  "building feature": "feature",
};

async function seedAmenities() {
  const all: {
    name: string;
    category: "rooftop" | "signature" | "building feature";
    order: number;
  }[] = [
    ...rooftopAmenities.map((name, i) => ({ name, category: "rooftop" as const, order: i })),
    ...signatureAmenities.map((name, i) => ({ name, category: "signature" as const, order: i })),
    ...buildingFeatureAmenities.map((name, i) => ({
      name,
      category: "building feature" as const,
      order: i,
    })),
  ];
  console.log(`Seeding ${all.length} amenities...`);
  for (const a of all) {
    const id = `amenity-${AMENITY_ID_PREFIX[a.category]}-${slugify(a.name)}`;
    await client.createOrReplace({ _id: id, _type: "amenity", ...a });
  }

  // These 6 amenities moved from "rooftop" to "signature" (location not
  // confirmed in the brochure) — remove the stale rooftop-prefixed docs.
  const staleIds = signatureAmenities.map((name) => `amenity-rooftop-${slugify(name)}`);
  await client.delete({ query: `*[_id in $ids]`, params: { ids: staleIds } });
}

async function seedFamilyMembers() {
  console.log(`Seeding ${familyMembers.length} family members...`);
  for (let i = 0; i < familyMembers.length; i++) {
    const { photoFile, photoHotspot, ...m } = familyMembers[i] as (typeof familyMembers)[number] & {
      photoHotspot?: { x: number; y: number; width: number; height: number };
    };
    const id = `family-${slugify(m.name)}`;

    const existing = await client.fetch<{ photo?: { asset?: { _ref: string } } } | null>(
      `*[_id == $id][0]{photo}`,
      { id }
    );
    const assetId = existing?.photo?.asset?._ref ?? (await uploadImage(photoFile));

    await client.createOrReplace({
      _id: id,
      _type: "familyMember",
      ...m,
      order: i,
      photo: {
        _type: "image",
        asset: { _type: "reference", _ref: assetId },
        ...(photoHotspot && {
          hotspot: { _type: "sanity.imageHotspot", ...photoHotspot },
        }),
      },
    });
  }
}

async function seedFinancingPlan() {
  console.log("Seeding financing plan...");
  await client.createOrReplace({
    _id: "financingPlan",
    _type: "financingPlan",
    selfFinanceRows: [
      { _key: "reservation", milestone: "Reservation", timeframe: "Day 1", option1: "$10,000", option2: "$10,000" },
      { _key: "first", milestone: "1st Instalment", timeframe: "30 Days", option1: "20%", option2: "40%" },
      { _key: "second", milestone: "2nd Instalment", timeframe: "4 Months", option1: "20%", option2: "—" },
      { _key: "third", milestone: "3rd Instalment", timeframe: "8 Months", option1: "20%", option2: "—" },
      { _key: "fourth", milestone: "4th Instalment", timeframe: "12 Months", option1: "20%", option2: "40%" },
      { _key: "final", milestone: "Final Instalment", timeframe: "Completion", option1: "20%", option2: "20%" },
    ],
    upfrontDiscountTiers: [
      { _key: "t100", upfrontPayment: "100%", discount: "12.5%" },
      { _key: "t90", upfrontPayment: "90%", discount: "11%" },
      { _key: "t80", upfrontPayment: "80%", discount: "9.5%" },
      { _key: "t70", upfrontPayment: "70%", discount: "8%" },
      { _key: "t60", upfrontPayment: "60%", discount: "6.5%" },
      { _key: "t50", upfrontPayment: "50%", discount: "5%" },
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
  console.log(`Seeding ${galleryEntries.length} gallery images (skipping re-upload if already present)...`);
  for (let i = 0; i < galleryEntries.length; i++) {
    const entry = galleryEntries[i];
    const id = `gallery-${entry.id}`;

    const existing = entry.forceReupload
      ? null
      : await client.fetch<{ image?: { asset?: { _ref: string } } } | null>(
          `*[_id == $id][0]{image}`,
          { id }
        );
    const assetId = existing?.image?.asset?._ref ?? (await uploadImage(entry.file));

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
    console.log(`  ${existing?.image?.asset ? "reused" : "uploaded"} ${entry.file} -> ${id}`);
  }

  if (STALE_GALLERY_IDS.length > 0) {
    await client.delete({ query: `*[_id in $ids]`, params: { ids: STALE_GALLERY_IDS } });
    console.log(`  removed ${STALE_GALLERY_IDS.length} stale gallery docs`);
  }
}

async function seedUnitLocationPlans() {
  console.log(`Seeding ${unitLocationPlans.length} unit location plans...`);
  for (const p of unitLocationPlans) {
    const id = `unit-location-${p.id}`;
    const existing = await client.fetch<{ image?: { asset?: { _ref: string } } } | null>(
      `*[_id == $id][0]{image}`,
      { id }
    );
    const assetId = existing?.image?.asset?._ref ?? (await uploadImage(p.file));
    await client.createOrReplace({
      _id: id,
      _type: "unitLocationPlan",
      floor: p.floor,
      units: p.units,
      image: {
        _type: "image",
        asset: { _type: "reference", _ref: assetId },
      },
    });
  }
}

async function seedConstructionUpdates() {
  console.log(`Seeding ${constructionUpdates.length} construction updates...`);
  for (let i = 0; i < constructionUpdates.length; i++) {
    const entry = constructionUpdates[i];
    const id = `construction-${slugify(entry.file.replace(/\.[^.]+$/, ""))}`;
    const existing = await client.fetch<{ image?: { asset?: { _ref: string } } } | null>(
      `*[_id == $id][0]{image}`,
      { id }
    );
    const assetId = existing?.image?.asset?._ref ?? (await uploadImage(entry.file));
    await client.createOrReplace({
      _id: id,
      _type: "constructionUpdate",
      alt: entry.alt,
      stage: entry.stage,
      order: i,
      image: {
        _type: "image",
        asset: { _type: "reference", _ref: assetId },
      },
    });
  }
}

async function seedSiteSettings() {
  console.log("Seeding site settings...");
  await client.createIfNotExists({
    _id: "siteSettings",
    _type: "siteSettings",
    contactPhone: "+233 (0)244 30 5262",
    contactEmail: "sales@lexington.com.gh",
    notificationEmail: "sales@lexington.com.gh",
    officeAddress: "Duala Close — Opposite Orchid Hotel, Shiashie",
    disclaimer:
      "All images displayed are for illustrative purposes only and may not reflect the final product. All prices are subject to change without notice.",
    heroEyebrow: "Shiashie · East Legon · Accra",
    heroTitle: "Seven storeys, one address worth arriving at.",
    heroLede:
      "One, two and three-bedroom duplex penthouse residences, built for a family whose name has shaped Ghana's skyline for three generations.",
    residencesIntro: {
      eyebrow: "Residences",
      title: "Every floor, priced and available in real time.",
      lede: "Filter by floor, bedroom type or availability — updated the moment a unit is reserved or sold.",
    },
    amenitiesIntro: {
      eyebrow: "Amenities",
      title: "World-class amenities, every day.",
      lede: "From a private rooftop garden to a fully-equipped gym, sauna and pool — built for daily life, not just weekends.",
    },
    galleryIntro: {
      eyebrow: "Gallery",
      title: "A closer look.",
      lede: "All images are illustrative renders and may not reflect the final product.",
    },
    progressIntro: {
      eyebrow: "Progress",
      title: "Building The Lexington.",
      lede: "Real photos from the site, updated as construction moves from the ground up.",
    },
    investIntro: {
      eyebrow: "Why Invest",
      title: "A legacy asset, not just a purchase.",
      lede: "Situated in a prime and highly desirable location, The Lexington offers an exceptional investment opportunity with the potential for consistent demand and a foundation for strong, long-term returns.",
    },
    aboutIntro: {
      eyebrow: "Skarlatos & Son",
      title: "Three generations shaping Ghana's landscape.",
      lede: "",
    },
    contactIntro: {
      eyebrow: "Contact",
      title: "Let's talk about your residence.",
      lede: "Reach us directly, or send your details below and we'll follow up with availability and a custom payment plan.",
    },
  });

  // createIfNotExists only creates — it doesn't patch fields onto a
  // siteSettings doc that already exists (which it does, in every real
  // environment this seed script runs against). Backfill just the new
  // field via setIfMissing so it never clobbers a value already edited
  // in Studio.
  await client
    .patch("siteSettings")
    .setIfMissing({
      progressIntro: {
        eyebrow: "Progress",
        title: "Building The Lexington.",
        lede: "Real photos from the site, updated as construction moves from the ground up.",
      },
    })
    .commit();
}

async function main() {
  await seedUnits();
  await seedAmenities();
  await seedFamilyMembers();
  await seedFinancingPlan();
  await seedGallery();
  await seedUnitLocationPlans();
  await seedConstructionUpdates();
  await seedSiteSettings();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
