import { Button } from "@/components/Button";
import { PageIntro } from "@/components/PageIntro";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata = {
  title: "Page not found | The Lexington",
  description: "That page doesn't exist. Head back to the residences or get in touch.",
  robots: { index: false, follow: true },
};

// Shown for any address that isn't a page. The plain default had no menu and
// no way back, so a mistyped link ended the visit.
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <PageIntro
          eyebrow="404"
          title="We can't find that page."
          lede="The link may be old or mistyped. These will get you back on track."
        />
        <section className="section sectionAlt" style={{ textAlign: "center" }}>
          <div className="wrap">
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
              <Button href="/" variant="clay">
                Back to the home page
              </Button>
              <Button href="/residences" variant="outline-dark">
                View residences
              </Button>
              <Button href="/contact" variant="outline-dark">
                Contact us
              </Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
