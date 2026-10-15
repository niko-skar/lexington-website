import { AsBuiltApp, type AsBuiltTab } from "@/components/asbuilt/AsBuiltApp";
import { isRealRecord, readFloors } from "@/lib/asbuilt/store";
import { requireAdminPage } from "@/lib/auth/requireAdmin";

export const metadata = {
  title: "As-built | The Lexington",
};

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const TABS: AsBuiltTab[] = ["plan", "list", "setout", "history"];

/**
 * The as-built record (Niko, 15 Oct 2026): every floor's grid, columns, lift
 * cores, openings and slab edges from the drawings, with what was actually
 * built typed in on site, a history of every change, and where to set out the
 * next floor's columns so they sit on the ones below.
 */
export default async function AsBuiltPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdminPage();

  const params = await searchParams;
  const floors = await readFloors();
  const asked = one(params.floor);
  // The 1st floor is where the work is (Oct 2026), so that's where it opens.
  const initialKey = floors.some((f) => f.key === asked)
    ? asked
    : floors.some((f) => f.key === "1")
      ? "1"
      : (floors[0]?.key ?? "1");
  const tab = one(params.view) as AsBuiltTab;

  return (
    <AsBuiltApp
      initialFloors={floors}
      initialKey={initialKey}
      initialTab={TABS.includes(tab) ? tab : "plan"}
      realRecord={isRealRecord()}
    />
  );
}
