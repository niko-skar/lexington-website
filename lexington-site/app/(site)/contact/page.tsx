import { PageIntro } from "@/components/PageIntro";
import { ContactForm } from "@/components/ContactForm";
import buttonStyles from "@/components/Button.module.css";
import styles from "./contact.module.css";

export const metadata = {
  title: "Contact & Reserve | The Lexington",
};

export default function ContactPage() {
  return (
    <>
      <PageIntro
        eyebrow="Contact"
        title="Let's talk about your residence."
        lede="Reach us directly, or send your details below and we'll follow up with availability and a custom payment plan."
      />

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className={styles.grid}>
            <div>
              <div className={styles.detail}>
                <div className={styles.key}>Phone</div>
                <div className={styles.value}>
                  <a href="tel:+233244305262">+233 (0)244 30 5262</a>
                </div>
              </div>
              <div className={styles.detail}>
                <div className={styles.key}>Email</div>
                <div className={styles.value}>
                  <a href="mailto:sales@lexington.com.gh">sales@lexington.com.gh</a>
                </div>
              </div>
              <div className={styles.detail}>
                <div className={styles.key}>Office</div>
                <div className={styles.value}>
                  Duala Close — Opposite Orchid Hotel, Shiashie
                </div>
              </div>

              <div className={styles.reserveBox}>
                <div className="eyebrow">Reserve a Unit</div>
                <p>
                  A minimum $10,000 reservation secures your residence. Card
                  and bank-transfer deposit options are available on request.
                </p>
                <a
                  href="mailto:sales@lexington.com.gh?subject=Reservation%20Enquiry%20-%20The%20Lexington"
                  className={`${buttonStyles.btn} ${buttonStyles.brass}`}
                  style={{ marginTop: 18 }}
                >
                  Start a Reservation
                </a>
              </div>
            </div>

            <ContactForm />
          </div>
        </div>
      </section>

      <section className="section sectionAlt">
        <div className="wrap">
          <p className="disclaimer">
            All images displayed are for illustrative purposes only and may
            not reflect the final product. All prices are subject to change
            without notice.
          </p>
        </div>
      </section>
    </>
  );
}
