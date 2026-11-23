// The units with a 3D model, by unit number: the name the script knows the model by, how the page names it, its floors, and
// the plan picture of each floor as the model itself sees it from straight above (night view), in the two shapes the plan box
// takes. The picture is on screen the moment the pop-up opens and stays until the live 3D view has started, so there is never
// an empty box: the live view starts from the very same camera and just takes over.
// Plain data (no browser code), so the server can read it too: the lead responder links these units' 3D plans.
export type PlanLevel = "lower" | "upper" | "main";

// The models are one self-contained script in /public/3d (built from the penthouse-3d project: src/site.js,
// build-site.mjs), only downloaded when someone asks for a 3D view. Bump the number after the script is rebuilt so
// browsers fetch the new one. Kept here, beside the list of what is in it, because two places load it: the Residences
// page (components/Penthouse3D.tsx) and a buyer's homes to pick from (components/PlanPicker.tsx).
// v14 (16 Nov 2026): PH2b, 405B, 204B, the 3rd floor's studios 304B and 305B, and the 1st floor's homes 101A-109B.
export const SITE_VIEWER_SRC = "/3d/ph2b.iife.js?v=20"; // v20 (23 Nov 2026): every other home of floors 2-6 and Studio 1 (20 homes). (v19, 23 Nov 2026: PH1a in its new layout.) (v18, 19 Nov 2026: 306B as a three-bedroom home.) (v17, 18 Nov 2026): PH2b's new layout (curved stair, glass wall to the terrace, BBQ bar under a pergola, a light over the stair, lit steps). (v16, 17 Nov 2026: 405B as the two-bedroom its buyer chose, the 5th floor's studios 504B and 505B. (v15, 17 Nov 2026: new layouts of 103B, 105B, 106B, 108B; the cooker hood's chimney)

export interface Model3D {
  viewerId: string;
  name: string;
  levels: PlanLevel[];
  posters: Partial<Record<PlanLevel, { wide: string; phone: string }>>;
}

export const MODELS: Record<string, Model3D> = {
  PH2b: {
    viewerId: "ph2b",
    name: "penthouse PH2b",
    levels: ["lower", "upper"],
    posters: {
      lower: { wide: "/3d/ph2b-plan-lower.jpg?v=2", phone: "/3d/ph2b-plan-lower-m.jpg?v=2" }, // v2 (18 Nov 2026): the new layout
      upper: { wide: "/3d/ph2b-plan-upper.jpg?v=2", phone: "/3d/ph2b-plan-upper-m.jpg?v=2" },
    },
  },
  // PH1a (23 Nov 2026): the 3-bedroom duplex penthouse in its new layout (penthouse-3d ph1a): bedrooms on the 6th floor, living,
  // kitchen, piano lounge and roof terrace on the 7th
  PH1a: {
    viewerId: "ph1a",
    name: "penthouse PH1a",
    levels: ["lower", "upper"],
    posters: {
      lower: { wide: "/3d/ph1a-plan-lower.jpg?v=1", phone: "/3d/ph1a-plan-lower-m.jpg?v=1" },
      upper: { wide: "/3d/ph1a-plan-upper.jpg?v=1", phone: "/3d/ph1a-plan-upper-m.jpg?v=1" },
    },
  },
  // 405B (17 Nov 2026): the two-bedroom home its buyer chose (penthouse-3d u4t), in place of the old three-bedroom concept.
  "405B": {
    viewerId: "u4t",
    name: "apartment 405B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u4t-plan.jpg?v=3", phone: "/3d/u4t-plan-m.jpg?v=3" } },
  },
  // The 5th floor's two studios (17 Nov 2026): 504B on the north side, 505B on the south side (the old 505B is 506B).
  "504B": {
    viewerId: "u5n",
    name: "studio 504B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u5n-plan.jpg?v=1", phone: "/3d/u5n-plan-m.jpg?v=1" } },
  },
  "505B": {
    viewerId: "u5s",
    name: "studio 505B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u5s-plan.jpg?v=1", phone: "/3d/u5s-plan-m.jpg?v=1" } },
  },
  "204B": {
    viewerId: "u204b",
    name: "studio 204B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u204b-plan.jpg?v=1", phone: "/3d/u204b-plan-m.jpg?v=1" } },
  },
  // The 3rd floor's two studios (16 Nov 2026): 304B on the north side, 305B on the south side.
  "304B": {
    viewerId: "u3n",
    name: "studio 304B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u3n-plan.jpg?v=1", phone: "/3d/u3n-plan-m.jpg?v=1" } },
  },
  "305B": {
    viewerId: "u3s",
    name: "studio 305B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u3s-plan.jpg?v=2", phone: "/3d/u3s-plan-m.jpg?v=2" } },
  },
  // The 1st floor's nine homes (16 Nov 2026): 101A and 104B are one-bedroom apartments, the rest studios.
  "101A": {
    viewerId: "u1fg",
    name: "apartment 101A",
    levels: ["main"],
    posters: { main: { wide: "/3d/u1fg-plan.jpg?v=1", phone: "/3d/u1fg-plan-m.jpg?v=1" } },
  },
  "102B": {
    viewerId: "u1a",
    name: "studio 102B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u1a-plan.jpg?v=1", phone: "/3d/u1a-plan-m.jpg?v=1" } },
  },
  "103B": {
    viewerId: "u1e",
    name: "studio 103B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u1e-plan.jpg?v=2", phone: "/3d/u1e-plan-m.jpg?v=2" } },
  },
  "104B": {
    viewerId: "u1b",
    name: "apartment 104B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u1b-plan.jpg?v=1", phone: "/3d/u1b-plan-m.jpg?v=1" } },
  },
  "105B": {
    viewerId: "u1f",
    name: "studio 105B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u1f-plan.jpg?v=2", phone: "/3d/u1f-plan-m.jpg?v=2" } },
  },
  "106B": {
    viewerId: "u1c",
    name: "studio 106B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u1c-plan.jpg?v=2", phone: "/3d/u1c-plan-m.jpg?v=2" } },
  },
  "107B": {
    viewerId: "u1g",
    name: "studio 107B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u1g-plan.jpg?v=1", phone: "/3d/u1g-plan-m.jpg?v=1" } },
  },
  "108B": {
    viewerId: "u1d",
    name: "studio 108B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u1d-plan.jpg?v=2", phone: "/3d/u1d-plan-m.jpg?v=2" } },
  },
  "109B": {
    viewerId: "u1h",
    name: "studio 109B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u1h-plan.jpg?v=1", phone: "/3d/u1h-plan-m.jpg?v=1" } },
  },
  // 306B (19 Nov 2026): the 3rd floor's east end as a three-bedroom home (penthouse-3d u306b).
  "306B": {
    viewerId: "u306b",
    name: "apartment 306B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u306b-plan.jpg?v=1", phone: "/3d/u306b-plan-m.jpg?v=1" } },
  },
  // 23 Nov 2026: every other home of floors 2 to 6 and Studio 1, as laid out on Niko's floor outlines (penthouse-3d u201a ...)
  "201A": {
    viewerId: "u201a",
    name: "apartment 201A",
    levels: ["main"],
    posters: { main: { wide: "/3d/u201a-plan.jpg?v=1", phone: "/3d/u201a-plan-m.jpg?v=1" } },
  },
  "202A": {
    viewerId: "u202a",
    name: "apartment 202A",
    levels: ["main"],
    posters: { main: { wide: "/3d/u202a-plan.jpg?v=1", phone: "/3d/u202a-plan-m.jpg?v=1" } },
  },
  "203B": {
    viewerId: "u203b",
    name: "apartment 203B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u203b-plan.jpg?v=1", phone: "/3d/u203b-plan-m.jpg?v=1" } },
  },
  "205B": {
    viewerId: "u205b",
    name: "apartment 205B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u205b-plan.jpg?v=1", phone: "/3d/u205b-plan-m.jpg?v=1" } },
  },
  "206B": {
    viewerId: "u206b",
    name: "apartment 206B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u206b-plan.jpg?v=1", phone: "/3d/u206b-plan-m.jpg?v=1" } },
  },
  "207B": {
    viewerId: "u207b",
    name: "apartment 207B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u207b-plan.jpg?v=1", phone: "/3d/u207b-plan-m.jpg?v=1" } },
  },
  "301A": {
    viewerId: "u301a",
    name: "apartment 301A",
    levels: ["main"],
    posters: { main: { wide: "/3d/u301a-plan.jpg?v=1", phone: "/3d/u301a-plan-m.jpg?v=1" } },
  },
  "302A": {
    viewerId: "u302a",
    name: "apartment 302A",
    levels: ["main"],
    posters: { main: { wide: "/3d/u302a-plan.jpg?v=1", phone: "/3d/u302a-plan-m.jpg?v=1" } },
  },
  "303B": {
    viewerId: "u303b",
    name: "apartment 303B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u303b-plan.jpg?v=1", phone: "/3d/u303b-plan-m.jpg?v=1" } },
  },
  "401A": {
    viewerId: "u401a",
    name: "apartment 401A",
    levels: ["main"],
    posters: { main: { wide: "/3d/u401a-plan.jpg?v=1", phone: "/3d/u401a-plan-m.jpg?v=1" } },
  },
  "402A": {
    viewerId: "u402a",
    name: "apartment 402A",
    levels: ["main"],
    posters: { main: { wide: "/3d/u402a-plan.jpg?v=1", phone: "/3d/u402a-plan-m.jpg?v=1" } },
  },
  "403B": {
    viewerId: "u403b",
    name: "apartment 403B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u403b-plan.jpg?v=1", phone: "/3d/u403b-plan-m.jpg?v=1" } },
  },
  "404B": {
    viewerId: "u404b",
    name: "apartment 404B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u404b-plan.jpg?v=1", phone: "/3d/u404b-plan-m.jpg?v=1" } },
  },
  "501A": {
    viewerId: "u501a",
    name: "apartment 501A",
    levels: ["main"],
    posters: { main: { wide: "/3d/u501a-plan.jpg?v=1", phone: "/3d/u501a-plan-m.jpg?v=1" } },
  },
  "502A": {
    viewerId: "u502a",
    name: "apartment 502A",
    levels: ["main"],
    posters: { main: { wide: "/3d/u502a-plan.jpg?v=1", phone: "/3d/u502a-plan-m.jpg?v=1" } },
  },
  "503B": {
    viewerId: "u503b",
    name: "apartment 503B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u503b-plan.jpg?v=1", phone: "/3d/u503b-plan-m.jpg?v=1" } },
  },
  "506B": {
    viewerId: "u506b",
    name: "apartment 506B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u506b-plan.jpg?v=1", phone: "/3d/u506b-plan-m.jpg?v=1" } },
  },
  "Studio 1": {
    viewerId: "ustudio1",
    name: "Studio 1",
    levels: ["main"],
    posters: { main: { wide: "/3d/ustudio1-plan.jpg?v=1", phone: "/3d/ustudio1-plan-m.jpg?v=1" } },
  },
  "601A": {
    viewerId: "u601a",
    name: "apartment 601A",
    levels: ["main"],
    posters: { main: { wide: "/3d/u601a-plan.jpg?v=1", phone: "/3d/u601a-plan-m.jpg?v=1" } },
  },
  "602B": {
    viewerId: "u602b",
    name: "apartment 602B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u602b-plan.jpg?v=1", phone: "/3d/u602b-plan-m.jpg?v=1" } },
  },
};

export function has3DModel(unitNumber: string): boolean {
  return unitNumber in MODELS;
}
