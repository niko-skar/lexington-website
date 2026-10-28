import { PlansApp, type WebsiteUnit } from "@/components/plans/PlansApp";
import { isRealRecord, readFloors } from "@/lib/asbuilt/store";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { readPlans, readReferences } from "@/lib/plans/store";
import { client } from "@/lib/sanity/client";

export const metadata = {
  title: "Floor plans | The Lexington",
};

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Floor plans drawn on the as-built record (Niko, 28 Oct 2026): walls, doors and windows on each
 * floor's real grid, columns and slab edges; each home's net internal area as the sale agreement
 * measures it, checked against what it is sold as. Layout options per floor, copied between floors.
 */
export default async function PlansPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdminPage();

  const params = await searchParams;
  const [floors, plans, units, references] = await Promise.all([
    readFloors(),
    readPlans(),
    client.fetch<WebsiteUnit[]>(`*[_type == "unit"]{ "unit": unitNumber, floor, areaSqm }`),
    readReferences(),
  ]);
  const asked = one(params.floor);
  // The 1st floor is where the as-built work is (Oct 2026), so that's where it opens.
  const floorKey = floors.some((f) => f.key === asked) ? asked : floors.some((f) => f.key === "1") ? "1" : (floors[0]?.key ?? "1");
  const askedOption = one(params.option);
  const option = plans.some((p) => p.floorKey === floorKey && p.option === askedOption)
    ? askedOption
    : (plans.filter((p) => p.floorKey === floorKey).sort((a, b) => a.option.localeCompare(b.option))[0]?.option ?? "a");

  return (
    <PlansApp
      floors={floors}
      plans={plans}
      units={units ?? []}
      references={references ?? []}
      realRecord={isRealRecord()}
      initialFloor={floorKey}
      initialOption={option}
    />
  );
}
