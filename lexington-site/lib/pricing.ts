import type { PackageTier, PackageTierKey, Unit } from "./sanity/types";

export function tierRate(key: PackageTierKey | undefined, tiers: PackageTier[]): number {
  return tiers.find((t) => t.key === (key ?? "standard"))?.ratePerSqm ?? 0;
}

// Dollar amount added on top of a unit's own (floor-tier) listed price to
// reach the requested tier — 0 if the requested tier is at or below the
// unit's floor tier.
export function tierAddon(unit: Unit, tierKey: PackageTierKey, tiers: PackageTier[]): number {
  const minRate = tierRate(unit.minPackageTier, tiers);
  const targetRate = tierRate(tierKey, tiers);
  const effectiveRate = Math.max(minRate, targetRate);
  return unit.areaSqm * (effectiveRate - minRate);
}

// A unit can't be priced below its own floor tier (penthouses floor at
// Premium) — the requested tier is clamped up to that floor if needed.
export function priceAtTier(unit: Unit, tierKey: PackageTierKey, tiers: PackageTier[]): number {
  return unit.priceUSD + tierAddon(unit, tierKey, tiers);
}

// True when the requested tier is below the unit's floor tier, i.e. the
// price shown is actually for a higher tier than what was asked for.
export function isTierClamped(unit: Unit, tierKey: PackageTierKey, tiers: PackageTier[]): boolean {
  return tierRate(unit.minPackageTier, tiers) > tierRate(tierKey, tiers);
}

export function floorTierName(unit: Unit, tiers: PackageTier[]): string {
  const key = unit.minPackageTier ?? "standard";
  return tiers.find((t) => t.key === key)?.name ?? "Standard";
}
