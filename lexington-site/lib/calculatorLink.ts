/** The price calculator's page (Niko, 25 Nov 2026: a page of its own, reached by a button). */
export const PRICE_CALCULATOR_PATH = "/price-calculator";

/**
 * A link to the price calculator with these homes already picked: one home as ?unit=203B (a home's pop-up), several as
 * ?units=203B,108B (Residences' Compare). The page keeps the ones still for sale, up to four.
 */
export function calculatorHref(unitNumbers: readonly string[]): string {
  const units = [...new Set(unitNumbers.map((u) => u.trim()).filter(Boolean))];
  if (units.length === 0) return PRICE_CALCULATOR_PATH;
  if (units.length === 1) return `${PRICE_CALCULATOR_PATH}?unit=${encodeURIComponent(units[0])}`;
  return `${PRICE_CALCULATOR_PATH}?units=${units.map(encodeURIComponent).join(",")}`;
}
