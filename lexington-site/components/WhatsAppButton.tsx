import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import { whatsappUrl } from "@/lib/format";
import styles from "./WhatsAppButton.module.css";

// Mobile-only (hidden via CSS above the breakpoint) — on desktop the phone
// and email links in the header/footer/contact page are enough; on mobile,
// a thumb-reachable floating button matches how people actually reach out
// in this market.
export async function WhatsAppButton() {
  const siteSettings = await client.fetch<SiteSettings>(siteSettingsQuery);

  return (
    <a
      className={styles.button}
      href={whatsappUrl(siteSettings.contactPhone, "Hi, I'm interested in The Lexington.")}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Message us on WhatsApp"
    >
      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
        <path d="M12.04 2c-5.52 0-10 4.48-10 10 0 1.77.46 3.5 1.33 5.02L2 22l5.13-1.35a9.96 9.96 0 0 0 4.91 1.29h.01c5.52 0 10-4.48 10-10s-4.48-9.94-10.01-9.94zm5.86 14.15c-.25.7-1.45 1.34-2 1.42-.51.08-1.15.11-1.86-.12-.43-.14-.98-.31-1.68-.61-2.96-1.28-4.89-4.26-5.04-4.46-.15-.2-1.21-1.61-1.21-3.07s.76-2.18 1.03-2.48c.27-.3.59-.37.78-.37.2 0 .39 0 .56.01.18.01.42-.07.65.5.25.6.84 2.07.91 2.22.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.38-.44.51-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.02 1.12 1 2.06 1.31 2.36 1.46.3.15.48.13.65-.08.18-.2.75-.87.95-1.17.2-.3.4-.25.66-.15.27.1 1.72.81 2.01.96.3.15.49.22.56.35.07.13.07.72-.18 1.42z" />
      </svg>
    </a>
  );
}
