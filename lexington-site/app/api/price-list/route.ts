import { priceListFileName } from "@/lib/priceList/data";
import { loadPriceList } from "@/lib/priceList/load";
import { buildPriceListPdf } from "@/lib/priceList/pdf";

// GET /api/price-list: today's price list as a PDF, made from the live data each time (25 Nov 2026). The link is what a
// visitor gets after asking for the price list on the website, and what the team can send on WhatsApp. Nothing on it
// is private (the same prices are on Residences), but it is kept out of search results: a stale copy in Google would
// mislead. The CDN keeps a copy for 10 minutes, like the pages.
export async function GET() {
  try {
    const data = await loadPriceList();
    const pdf = await buildPriceListPdf(data);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${priceListFileName(data.issuedOn)}"`,
        "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=60",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error("[price list] could not be made:", error instanceof Error ? error.message : error);
    return new Response("The price list could not be made just now. Please try again in a minute, or see the prices at https://www.lexington.com.gh/residences", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
