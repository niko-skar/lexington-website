import { splitOffer } from "@/lib/offerText";

import { Button } from "./Button";
import { Reveal } from "./Reveal";
import styles from "./OfferBand.module.css";

/**
 * The current offer, shown at the top of the Invest page. `limited`: the offer has a last day.
 * `after`: while it runs, the smaller discounts that take over after its last day ("From 1 December: …").
 */
export function OfferBand({ message, limited = true, after }: { message: string; limited?: boolean; after?: string | null }) {
  const { headline, detail } = splitOffer(message);
  if (!headline) return null;

  return (
    <section className={styles.band} aria-label="Current offer">
      <div className="wrap">
        <Reveal>
          <div className={styles.inner}>
            <div className={styles.copy}>
              <div className={styles.eyebrow}>{limited ? "Limited-time offer" : "Current offer"}</div>
              <h2 className={styles.headline}>{/[.!?]$/.test(headline) ? headline : `${headline}.`}</h2>
              {detail && <p className={styles.detail}>{detail}</p>}
              {after && <p className={styles.after}>{after}</p>}
            </div>
            <div className={styles.actions}>
              <Button href="/reserve" variant="brass">
                Start Your Reservation
              </Button>
              <Button href="/contact" variant="outline-light">
                Ask About a Payment Plan
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
