# The Lexington — Website

Next.js (App Router) marketing site for The Lexington, Shiashie, East Legon,
backed by a Sanity CMS embedded at `/studio`.

## Structure

```
app/(site)/        Marketing pages (Home, Residences, Amenities, Gallery, Invest, About, Contact)
app/studio/        Embedded Sanity Studio
components/        Shared UI components
lib/sanity/        Sanity client, GROQ queries, TypeScript types
sanity/            Sanity schema types + Studio structure/config
scripts/seed.ts    One-time seed script (units, amenities, family, financing plan, gallery images)
```

## Content model

Managed in Sanity Studio (`/studio`):

- **Unit** — unit number, floor, bedroom type, area, price, status (available/reserved/sold)
- **Gallery image** — image, alt text, category (exterior/interior/amenity/floorplan/family)
- **Amenity** — name, category (rooftop/building feature)
- **Family member** — name, years, bio (About page timeline)
- **Financing plan** — singleton: self-finance rows, mortgage rows, buy-to-rent rates

Everything else (contact details, disclaimer, location list, extras pricing) is static copy in the page components.

## Local development

Requires Node.js and the three env vars below in `.env.local`:

```
NEXT_PUBLIC_SANITY_PROJECT_ID=2p1ef4hj
NEXT_PUBLIC_SANITY_DATASET=production
SANITY_API_TOKEN=<a token with read access; Editor token also works>
```

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the site, `/studio` for the CMS.

### Re-seeding content

`scripts/seed-images/` holds the source JPEGs used by the seed script. Re-running is idempotent (documents use deterministic `_id`s):

```bash
npm run seed
```

## Deploy

Deploys to Vercel from this repo's `lexington-site/` directory (set as the project's Root Directory). Add the same three env vars in Vercel → Project Settings → Environment Variables.

The embedded Studio needs its origin allow-listed in Sanity: manage.sanity.io → project → API → CORS Origins → add `http://localhost:3000` for local dev and the site's production/preview domains.
