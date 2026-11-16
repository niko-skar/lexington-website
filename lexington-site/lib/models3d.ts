// The units with a 3D model, by unit number: the name the script knows the model by, how the page names it, its floors, and
// the plan picture of each floor as the model itself sees it from straight above (night view), in the two shapes the plan box
// takes. The picture is on screen the moment the pop-up opens and stays until the live 3D view has started, so there is never
// an empty box: the live view starts from the very same camera and just takes over.
// Plain data (no browser code), so the server can read it too: the lead responder links these units' 3D plans.
export type PlanLevel = "lower" | "upper" | "main";

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
      lower: { wide: "/3d/ph2b-plan-lower.jpg", phone: "/3d/ph2b-plan-lower-m.jpg" },
      upper: { wide: "/3d/ph2b-plan-upper.jpg", phone: "/3d/ph2b-plan-upper-m.jpg" },
    },
  },
  "405B": {
    viewerId: "u405b",
    name: "apartment 405B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u405b-plan.jpg?v=2", phone: "/3d/u405b-plan-m.jpg?v=2" } }, // v2: shot with the live view's own lens
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
    posters: { main: { wide: "/3d/u3s-plan.jpg?v=1", phone: "/3d/u3s-plan-m.jpg?v=1" } },
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
    posters: { main: { wide: "/3d/u1e-plan.jpg?v=1", phone: "/3d/u1e-plan-m.jpg?v=1" } },
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
    posters: { main: { wide: "/3d/u1f-plan.jpg?v=1", phone: "/3d/u1f-plan-m.jpg?v=1" } },
  },
  "106B": {
    viewerId: "u1c",
    name: "studio 106B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u1c-plan.jpg?v=1", phone: "/3d/u1c-plan-m.jpg?v=1" } },
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
    posters: { main: { wide: "/3d/u1d-plan.jpg?v=1", phone: "/3d/u1d-plan-m.jpg?v=1" } },
  },
  "109B": {
    viewerId: "u1h",
    name: "studio 109B",
    levels: ["main"],
    posters: { main: { wide: "/3d/u1h-plan.jpg?v=1", phone: "/3d/u1h-plan-m.jpg?v=1" } },
  },
};

export function has3DModel(unitNumber: string): boolean {
  return unitNumber in MODELS;
}
