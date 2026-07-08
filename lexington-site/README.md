# The Lexington — Website

A static site (plain HTML/CSS/JS, no build step) for The Lexington, built from the property brochure.

## Structure
```
index.html        Home
residences.html   Unit listings by floor (interactive floor selector) + pricing
amenities.html    Features & amenities
gallery.html      Photo gallery
invest.html       Financing plans, payment schedule, buy-to-rent
about.html        Skarlatos & Son family history
contact.html      Contact details + enquiry form (opens email client)
css/style.css     All styling
js/main.js        Mobile nav + floor selector interactivity
images/           Photos extracted from the brochure, optimized for web
```

## Deploy to Vercel via GitHub

1. **Push to GitHub**
   - Create a new repo (or use your existing one).
   - Copy all files in this folder into the repo root — keep the folder structure exactly as-is.
   - Commit and push:
     ```
     git add .
     git commit -m "Lexington website"
     git push
     ```

2. **Connect to Vercel**
   - In Vercel: New Project → Import your GitHub repo.
   - Framework preset: choose **Other** (this is a static site, no build command needed).
   - Leave Build Command and Output Directory blank — Vercel will serve the files as-is.
   - Click Deploy.

3. **Point your domain**
   - In the Vercel project: Settings → Domains → add `lexington.com.gh`.
   - Vercel will show the exact A/CNAME records to set — update them in your DNS panel the same way you did for the Shopify connection.
   - Once DNS propagates, remove/replace the old Shopify A and www CNAME records so the domain resolves here instead.

## Editing content later
- Unit prices/floors: edit the tables directly in `residences.html`.
- Photos: replace files in `images/` (keep the same filenames) or add new `<img>` tags where needed.
- Contact details, phone numbers, financing tables: plain text in each `.html` file — no CMS, just edit and re-push to GitHub, Vercel redeploys automatically.

## Known placeholders
- The enquiry form on `contact.html` currently opens the visitor's email client with a pre-filled message (no backend). If you want submissions to go to a database or trigger notifications, that needs a small backend (e.g. a Vercel serverless function) — happy to add this next.
- No payment integration yet. When ready to accept the $10,000 reservation deposit by card, we can wire in Paystack on the "Reserve" button.
