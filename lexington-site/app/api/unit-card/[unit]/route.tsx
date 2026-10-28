import { ImageResponse } from "next/og";

import { formatFloor, formatUSD } from "@/lib/format";
import { client } from "@/lib/sanity/client";
import { cardVersion } from "@/lib/unitCard";
import { vatFrom, type VatSetting } from "@/lib/vat";

// A residence's card as a picture, drawn like its card on the website (the name, AVAILABLE, the
// floor, type and size, the price and the floor plan), for the chat assistant to send in Messenger,
// Instagram and WhatsApp. Niko, 23 Oct 2026: "that response is too long and too many numbers, best
// if you can take the floor plan and prices like these floor plan and price cards". Always the
// website's own live figures; public, like the website itself.

const W = 1080;
const H = 1350;
const PAD = 72;

const STATUS: Record<string, { label: string; color: string; fill: string }> = {
  available: { label: "Available", color: "#2f5068", fill: "rgba(111, 147, 172, 0.16)" },
  reserved: { label: "Reserved", color: "#76592a", fill: "rgba(176, 141, 87, 0.16)" },
  sold: { label: "Sold", color: "#8b4a34", fill: "rgba(139, 74, 52, 0.14)" },
};

interface CardUnit {
  unitNumber: string;
  floor: number;
  bedroomType: string;
  areaSqm: number;
  priceUSD: number;
  status: string;
  minPackageTier?: string;
  tierName?: string;
  plan?: { url?: string; w?: number; h?: number } | null;
  vat?: VatSetting | null;
}

const QUERY = `*[_type == "unit" && unitNumber == $unit][0]{
  unitNumber, floor, bedroomType, areaSqm, priceUSD, status, minPackageTier,
  "tierName": *[_type == "packageTiers"][0].tiers[key == ^.minPackageTier][0].name,
  "vat": *[_type == "siteSettings"][0].vat,
  "plan": floorPlans[0]->{ "url": image.asset->url, "w": image.asset->metadata.dimensions.width, "h": image.asset->metadata.dimensions.height }
}`;

// The website's faces: Playfair Display for names and prices, Inter for the rest. Loaded once per
// server from Google Fonts (the form the picture maker reads); without them it falls back to its own.
const fonts = new Map<string, Promise<ArrayBuffer | null>>();
function font(family: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}`;
  if (!fonts.has(key)) {
    fonts.set(
      key,
      (async () => {
        try {
          const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}`)).text();
          const src = /src: url\((.+?)\) format\('(opentype|truetype)'\)/.exec(css)?.[1];
          if (!src) return null;
          const file = await fetch(src);
          return file.ok ? await file.arrayBuffer() : null;
        } catch {
          return null;
        }
      })()
    );
  }
  return fonts.get(key)!;
}

export async function GET(request: Request, { params }: { params: Promise<{ unit: string }> }): Promise<Response> {
  const name = decodeURIComponent((await params).unit).trim().slice(0, 40);
  const unit = name ? await client.fetch<CardUnit | null>(QUERY, { unit: name }, { cache: "no-store" }) : null;
  if (!unit) return new Response("No such residence.", { status: 404 });

  // Only the current card is drawn: any other address goes to it (security check, 27 Oct 2026), so
  // asking with made-up versions can't make the server draw pictures over and over.
  const vat = vatFrom(unit);
  const version = cardVersion({ ...unit, type: unit.bedroomType }, vat);
  const url = new URL(request.url);
  if (url.searchParams.get("v") !== version || [...url.searchParams.keys()].length !== 1) {
    const current = new URL(`/api/unit-card/${encodeURIComponent(unit.unitNumber)}`, url);
    current.searchParams.set("v", version);
    return new Response(null, { status: 307, headers: { Location: current.toString(), "Cache-Control": "public, max-age=60, s-maxage=60" } });
  }

  const [serif, sans, sansBold] = await Promise.all([font("Playfair Display", 600), font("Inter", 400), font("Inter", 600)]);
  const status = STATUS[unit.status] ?? STATUS.available;
  const tierNote = unit.minPackageTier && unit.minPackageTier !== "standard" && unit.tierName ? `${unit.tierName} included as standard` : "";

  // The plan, as large as fits in its frame and never stretched.
  const boxW = W - PAD * 2 - 2 * 32;
  const boxH = 760;
  const ratio = unit.plan?.w && unit.plan?.h ? unit.plan.w / unit.plan.h : 1;
  const planW = Math.round(Math.min(boxW, boxH * ratio));
  const planH = Math.round(planW / ratio);
  // The plans have see-through edges: filled with the frame's cream (a JPEG would turn them black).
  const planSrc = unit.plan?.url ? `${unit.plan.url}?w=${Math.min(1400, planW * 2)}&fm=jpg&q=85&bg=fbf9f4` : null;

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: "#f7f4ec", padding: `${PAD}px ${PAD}px 52px`, fontFamily: "Inter", color: "#15181a" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontFamily: "Playfair", fontSize: 108, lineHeight: 1 }}>{unit.unitNumber}</div>
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              alignItems: "center",
              marginTop: 20,
              padding: "16px 30px",
              borderRadius: 999,
              background: status.fill,
              color: status.color,
              fontFamily: "Inter Bold",
              fontSize: 30,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            <div style={{ width: 14, height: 14, borderRadius: 7, background: status.color, marginRight: 14 }} />
            {status.label}
          </div>
        </div>
        <div style={{ marginTop: 26, fontSize: 40, color: "#555555" }}>{`Floor ${formatFloor(unit.floor)} · ${unit.bedroomType} · ${unit.areaSqm} sqm`}</div>
        <div style={{ marginTop: 14, display: "flex", alignItems: "baseline" }}>
          <div style={{ fontFamily: "Playfair", fontSize: 72, lineHeight: 1.1 }}>{formatUSD(unit.priceUSD)}</div>
          {vat.on ? (
            <div style={{ marginLeft: 18, fontFamily: "Inter Bold", fontSize: 34, letterSpacing: 2, color: "#8a6c3e" }}>+ VAT</div>
          ) : null}
        </div>
        {tierNote ? <div style={{ marginTop: 6, fontSize: 28, color: "#8b4a34" }}>{tierNote}</div> : null}

        <div
          style={{
            marginTop: 40,
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid #d6d0c2",
            borderRadius: 16,
            background: "#fbf9f4",
          }}
        >
          {planSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- drawn into a picture, not a page
            <img src={planSrc} width={planW} height={planH} alt="" />
          ) : (
            <div style={{ fontSize: 34, color: "#555555" }}>Floor plan on request</div>
          )}
        </div>

        <div style={{ marginTop: 30, display: "flex", justifyContent: "space-between", fontSize: 26, letterSpacing: 4, color: "#76592a" }}>
          <div>THE LEXINGTON · SHIASHIE, EAST LEGON</div>
          <div style={{ letterSpacing: 1 }}>lexington.com.gh</div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        ...(serif ? [{ name: "Playfair", data: serif, weight: 600 as const, style: "normal" as const }] : []),
        ...(sans ? [{ name: "Inter", data: sans, weight: 400 as const, style: "normal" as const }] : []),
        ...(sansBold ? [{ name: "Inter Bold", data: sansBold, weight: 600 as const, style: "normal" as const }] : []),
      ],
      // A few minutes on the way, so a price or status change shows soon; the chat asks with a
      // version of the unit's figures in the address anyway.
      headers: { "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=3600" },
    }
  );
}
