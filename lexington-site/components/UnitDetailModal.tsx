"use client";

import Image from "next/image";
import { useEffect } from "react";

import type { GalleryImage, PackageTier, PackageTierKey, Unit, UnitLocationPlan } from "@/lib/sanity/types";
import { trackAction } from "@/lib/visits/client";
import { urlFor } from "@/lib/sanity/image";
import { formatFloor, formatUSD, whatsappUrl } from "@/lib/format";
import { VatTag } from "./Vat";
import { balconyOf, formatArea, splitArea, terraceOf } from "@/lib/area";
import { useAreaUnit } from "./useAreaUnit";
import { floorTierName, isTierClamped, priceAtTier, tierAddon } from "@/lib/pricing";
import { inclVatSuffix, withVat, type Vat } from "@/lib/vat";
import { Unit3DPlan, has3DModel, levelOfPlan } from "./Penthouse3D";
import { StatusBadge } from "./StatusBadge";
import { useDialog } from "./useDialog";
import { WhatsAppIcon } from "./WhatsAppIcon";
import { unitWhatsAppText } from "@/lib/unitMessage";
import styles from "./UnitDetailModal.module.css";

interface UnitDetailModalProps {
  unit: Unit;
  floorPlans: GalleryImage[];
  locationPlan?: UnitLocationPlan;
  tiers: PackageTier[];
  selectedTier: PackageTierKey;
  vat: Vat;
  /** The sales number (Site settings), for the pop-up's WhatsApp button. */
  contactPhone: string;
  onClose: () => void;
}

// Duplex penthouse floor plans are captioned "... — lower floor" / "...
// upper floor (rooftop level)" — pull the part after the dash as a label
// whenever there's more than one plan to show for a unit.
function planLabel(alt: string) {
  const label = alt.split("—")[1]?.trim();
  if (!label) return null;
  return label.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function UnitDetailModal({
  unit,
  floorPlans,
  locationPlan,
  tiers,
  selectedTier,
  vat,
  contactPhone,
  onClose,
}: UnitDetailModalProps) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  const areaUnit = useAreaUnit();

  // The dashboard's "Units opened most" (each unit counts once per visit).
  useEffect(() => {
    trackAction("unit", unit.unitNumber);
  }, [unit.unitNumber]);

  // Homes whose record says how much of the size is balcony (or roof terrace) show the internal area and those separately.
  const balconySqm = balconyOf(unit);
  const terraceSqm = terraceOf(unit);
  const areas = balconySqm > 0 || terraceSqm > 0 ? splitArea(unit.areaSqm, balconySqm, areaUnit, terraceSqm) : null;

  const has3D = has3DModel(unit.unitNumber);
  const clamped = isTierClamped(unit, selectedTier, tiers);
  const addon = tierAddon(unit, selectedTier, tiers);
  // As people see them: with the VAT in it while VAT is on.
  const shown = withVat(priceAtTier(unit, selectedTier, tiers), vat);
  const base = withVat(unit.priceUSD, vat);
  const available = unit.status === "available";
  // The finish named in the message only when it isn't the one every home comes with (or the one a penthouse includes).
  const chosenTier = tiers.find((t) => t.key === selectedTier);
  const finish = !clamped && chosenTier && chosenTier.ratePerSqm > 0 ? chosenTier.name : null;
  const whatsappHref = whatsappUrl(
    contactPhone,
    unitWhatsAppText({
      unitNumber: unit.unitNumber,
      bedroomType: unit.bedroomType,
      status: unit.status,
      area: formatArea(unit.areaSqm, areaUnit),
      price: `${formatUSD(shown)}${inclVatSuffix(vat)}`,
      finish,
    })
  );
  const unitQuery = encodeURIComponent(unit.unitNumber);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Unit ${unit.unitNumber}: floor plan and price`}
    >
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className={styles.head}>
          <div>
            <div className={styles.unitNumber}>{unit.unitNumber}</div>
            <div className={styles.meta}>
              Floor {formatFloor(unit.floor)} · {unit.bedroomType} · {formatArea(unit.areaSqm, areaUnit)}
            </div>
            {areas && (
              <dl className={styles.areas}>
                <div>
                  <dt>Internal area</dt>
                  <dd>{areas.internal}</dd>
                </div>
                {balconySqm > 0 && (
                  <div>
                    <dt>Balcony</dt>
                    <dd>{areas.balcony}</dd>
                  </div>
                )}
                {terraceSqm > 0 && (
                  <div>
                    <dt>Terrace</dt>
                    <dd>{areas.terrace}</dd>
                  </div>
                )}
                <div>
                  <dt>Total area</dt>
                  <dd>{formatArea(unit.areaSqm, areaUnit)}</dd>
                </div>
              </dl>
            )}
            <div className={styles.price}>
              {formatUSD(shown)}
              <VatTag vat={vat} />
              {clamped ? (
                <span className={styles.priceNote}>{floorTierName(unit, tiers)} included as standard</span>
              ) : (
                addon > 0 && (
                  <span className={styles.priceBreakdown}>
                    {formatUSD(base)} + {formatUSD(shown - base)}
                  </span>
                )
              )}
            </div>
          </div>
          <StatusBadge status={unit.status} />
        </div>
        {available && (
          <a className={styles.calcLink} href={`/invest?unit=${unitQuery}#calculator`}>
            Work out the payments for {unit.unitNumber}
          </a>
        )}

        {/* The units with a 3D model (PH2b, 405B, 204B) get their 3D plan as the first thing under the price. */}
        {has3D && (
          <>
            <div className={styles.planLabel}>3D floor plan</div>
            <Unit3DPlan unitNumber={unit.unitNumber} startLevel={levelOfPlan(unit.unitNumber, floorPlans[0]?.alt)} />
            {floorPlans.length > 0 && <div className={styles.planLabel}>2D floor plans</div>}
          </>
        )}

        {floorPlans.length > 0 ? (
          <div className={styles.plans}>
            {floorPlans.map((plan) => (
              <div key={plan._id}>
                {floorPlans.length > 1 && (
                  <div className={styles.planLabel}>{planLabel(plan.alt)}</div>
                )}
                <div className={styles.imageWrap}>
                  <Image
                    src={urlFor(plan.image).width(900).url()}
                    alt={plan.alt}
                    width={900}
                    height={900}
                    sizes="(max-width: 720px) 100vw, 720px"
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.noPlan}>
            Floor plan for this unit type is available on request.
          </p>
        )}

        {locationPlan && (
          <>
            <div className={styles.planLabel}>Location in Building</div>
            <div className={styles.imageWrap}>
              <Image
                src={urlFor(locationPlan.image).width(900).url()}
                alt={`Floor ${formatFloor(locationPlan.floor)} location plan showing unit ${unit.unitNumber}`}
                width={900}
                height={900}
                sizes="(max-width: 720px) 100vw, 720px"
              />
            </div>
          </>
        )}

        {/* The next step, always in reach at the foot of the pop-up while the plans scroll under it. */}
        <div className={styles.actions} role="group" aria-label={`Next steps for ${unit.unitNumber}`}>
          <a className={`${styles.action} ${styles.whatsapp}`} href={whatsappHref} target="_blank" rel="noopener noreferrer">
            <WhatsAppIcon size={18} />
            {/* One piece of text, so the button's gap sits only between the icon and the words. */}
            <span>
              {available ? (
                <>
                  Ask about {unit.unitNumber}
                  <span className={styles.wide}> on WhatsApp</span>
                </>
              ) : (
                "Ask about similar homes"
              )}
            </span>
          </a>
          <a className={styles.action} href={`/visit?home=${unitQuery}`}>
            Book a visit
          </a>
          {available && (
            <a className={`${styles.action} ${styles.reserve}`} href={`/reserve?unit=${unitQuery}`}>
              <span>
                Reserve<span className={styles.wide}> {unit.unitNumber}</span>
              </span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
