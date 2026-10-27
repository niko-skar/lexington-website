import { splitOffer } from "@/lib/offerText";

import { Button } from "./Button";
import { Reveal } from "./Reveal";
import styles from "./OfferBand.module.css";

/** The current offer, shown at the top of the Invest page. */
export function OfferBand({ message }: { message: string }) {
  const { headline, detail } = splitOffer(message);
  if (!headline) return null;

  return (
    <section className={styles.band} aria-label="Current offer">
      <div className="wrap">
        <Reveal>
          <div className={styles.inner}>
            <div className={styles.copy}>
              <div className={styles.eyebrow}>Limited-time offer</div>
              <h2 className={styles.headline}>{/[.!?]$/.test(headline) ? headline : `${headline}.`}</h2>
              {detail && <p className={styles.detail}>{detail}</p>}
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
