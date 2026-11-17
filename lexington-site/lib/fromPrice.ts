import "server-only";

import { client } from "@/lib/sanity/client";
import { PRICE_FROM_USD } from "@/lib/seo";

/**
 * The "from" price in search results, share previews and structured data: the lowest list price (before VAT)
 * of the homes still for sale, read from the units like the home page's own "from" price. If none is for sale
 * or the units can't be read, the fixed fallback in lib/seo.ts.
 */
export async function lowestPriceUSD(): Promise<number> {
  const prices = await client
    .fetch<Array<number | null>>(`*[_type == "unit" && status == "available"].priceUSD`)
    .catch((): Array<number | null> => []);
  const real = prices.filter((p): p is number => typeof p === "number" && p > 0);
  return real.length ? Math.min(...real) : PRICE_FROM_USD;
}
