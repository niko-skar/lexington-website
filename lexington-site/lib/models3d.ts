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
    posters: { main: { wide: "/3d/u405b-plan.jpg?v=1", phone: "/3d/u405b-plan-m.jpg?v=1" } },
  },
};

export function has3DModel(unitNumber: string): boolean {
  return unitNumber in MODELS;
}
