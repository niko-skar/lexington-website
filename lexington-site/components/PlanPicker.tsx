"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { formatUSD } from "@/lib/format";
import po from "./PlanOptions.module.css";
import styles from "./PlanPicker.module.css";

// Homes a buyer can pick from (Niko, 16 Nov 2026: a buyer who wants separate homes on different floors looks at each one
// in 3D, ticks the ones he wants and sees his price add up). Laid out so it explains itself (his word, later that day:
// "make it better and more intuitive to use"): the homes are cards with a picture; a tap on a card shows that home in
// the 3D view, which stays beside the cards on a wide screen; "Select" on a card adds it; the price is always on screen
// in a bar at the bottom.
// The models are one self-contained script in /public/3d, built from the penthouse-3d project (build-offerpick.mjs); it
// is only downloaded on this page. Bump the number after the script is rebuilt so browsers fetch the new one.
const VIEWER_SRC = "/3d/offerpick.iife.js?v=2";

export interface PlanPickView {
  key: string;
  title: string;
  floorLabel: string;
  /** "home" for the main home, "studio" for the studios listed under it. */
  group: "home" | "studio";
  /** The model's id in the 3D script. */
  model: string;
  /** The home seen from straight above: shown until the 3D view is ready, and on its card. */
  poster: string;
  insideSqm: number;
  balconySqm: number;
  listPriceUSD: number | null;
  priceUSD: number;
  preselected: boolean;
}

interface Viewer {
  dispose: () => void;
  toggleFullscreen?: () => void;
}
interface ViewerApi {
  mountUnit: (host: HTMLElement, id: string, options: Record<string, unknown>) => Promise<Viewer>;
}

let pending: Promise<ViewerApi> | null = null;

function loadViewer(): Promise<ViewerApi> {
  const w = window as unknown as { LEXPICK?: ViewerApi };
  if (w.LEXPICK) return Promise.resolve(w.LEXPICK);
  if (!pending) {
    pending = new Promise<ViewerApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = VIEWER_SRC;
      script.async = true;
      script.onload = () => (w.LEXPICK ? resolve(w.LEXPICK) : reject(new Error("3D viewer did not start")));
      script.onerror = () => {
        pending = null;
        reject(new Error("3D viewer could not be loaded"));
      };
      document.head.appendChild(script);
    });
  }
  return pending;
}

// Touch screens: a finger on the 3D view turns the model instead of scrolling the page, so there it starts "locked"
// (the page scrolls as usual) and a tap on the picture unlocks it.
function useCoarsePointer() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(pointer: coarse)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false
  );
}

const sqm = (v: number) => `${v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m²`;
const sizeOf = (p: PlanPickView) => (p.balconySqm > 0 ? `${sqm(p.insideSqm)} + ${sqm(p.balconySqm)} balcony` : sqm(p.insideSqm));
const savingOf = (list: number | null, price: number) => (list && list > price ? list - price : 0);

export function PlanPicker({ picks }: { picks: PlanPickView[] }) {
  const [viewKey, setViewKey] = useState(picks[0].key);
  const [chosen, setChosen] = useState<string[]>(() => picks.filter((p) => p.preselected).map((p) => p.key));
  const viewing = picks.find((p) => p.key === viewKey) ?? picks[0];
  const liveRef = useRef<HTMLDivElement>(null);
  const viewerBoxRef = useRef<HTMLElement>(null);
  const totalRef = useRef<HTMLElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  // Which model the 3D view is showing ("" while it loads), and one that could not start.
  const [ready, setReady] = useState("");
  const [failed, setFailed] = useState("");
  const coarse = useCoarsePointer();
  const [locked, setLocked] = useState(true); // only matters on touch screens

  useEffect(() => {
    const live = liveRef.current;
    if (!live) return;
    // A fresh element for every start, so React's double-run of effects in development can't leave two viewers in one box.
    const host = document.createElement("div");
    host.className = po.host;
    live.appendChild(host);
    let cancelled = false;
    let errored = false;

    loadViewer()
      .then((api) =>
        api.mountUnit(host, viewing.model, {
          initialView: "top", // the plan view, from straight above
          initialTime: "day",
          autoRotate: false,
          hideTitle: true,
          hideNote: true,
          compact: window.matchMedia("(max-width: 640px)").matches,
          onEvent: (name: string) => {
            if (!cancelled && name === "error") errored = true;
          },
        })
      )
      .then((v) => {
        if (cancelled) {
          v.dispose();
          return;
        }
        viewerRef.current = v;
        if (errored) setFailed(viewing.model);
        else setReady(viewing.model);
      })
      .catch(() => {
        if (!cancelled) setFailed(viewing.model);
      });

    return () => {
      cancelled = true;
      viewerRef.current?.dispose();
      viewerRef.current = null;
      host.remove();
    };
  }, [viewing.model]);

  const isReady = ready === viewing.model;
  const isFailed = failed === viewing.model;
  const gated = coarse && locked && isReady;
  const isChosen = (key: string) => chosen.includes(key);
  const toggle = (key: string) => setChosen((now) => (now.includes(key) ? now.filter((k) => k !== key) : [...now, key]));
  const show = (key: string) => {
    setViewKey(key);
    setLocked(true);
    // On a narrow screen the 3D view is above the cards: bring it back into sight.
    const box = viewerBoxRef.current;
    if (box && box.getBoundingClientRect().top < 0) box.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const mine = picks.filter((p) => isChosen(p.key));
  const total = mine.reduce((sum, p) => sum + p.priceUSD, 0);
  const allListed = mine.every((p) => p.listPriceUSD !== null);
  const totalList = allListed ? mine.reduce((sum, p) => sum + (p.listPriceUSD ?? 0), 0) : null;
  const totalSaving = savingOf(totalList, total);
  const groups: { name: string; note?: string; items: PlanPickView[] }[] = [
    { name: "Your home", items: picks.filter((p) => p.group === "home") },
    { name: "Studios", note: "Lower floors cost less.", items: picks.filter((p) => p.group === "studio") },
  ].filter((g) => g.items.length > 0);

  return (
    <div className={styles.wrap}>
      <ol className={styles.steps} aria-label="How this page works">
        <li>
          <b>1</b> Tap a home to see it in 3D
        </li>
        <li>
          <b>2</b> Press Select on the homes you want
        </li>
        <li>
          <b>3</b> Your price is at the bottom of the screen
        </li>
      </ol>

      <div className={styles.layout}>
        <section ref={viewerBoxRef} className={styles.viewer} aria-label="3D view">
          <div className={styles.viewHead}>
            <div>
              <p className={styles.showing}>Showing in 3D</p>
              <h2 className={styles.viewTitle}>
                {viewing.title} <span>{viewing.floorLabel}</span>
              </h2>
            </div>
            <p className={styles.viewPrice}>
              <span>{sizeOf(viewing)}</span>
              <b>{formatUSD(viewing.priceUSD)}</b>
            </p>
          </div>
          <div className={`${po.stage} ${isReady ? po.stageReady : ""}`} role="region" aria-label={`3D model of ${viewing.title}, ${viewing.floorLabel}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a plain picture behind the 3D view, swapped with the home */}
            <img key={viewing.poster} className={po.poster} src={viewing.poster} alt={`${viewing.title} seen from straight above`} />
            <div ref={liveRef} className={po.live} />
            {!isReady && !isFailed && (
              <div className={po.badge} role="status">
                <span className={po.spin} aria-hidden="true" />
                Loading the 3D model…
              </div>
            )}
            {isFailed && <div className={po.badge}>The 3D view can&rsquo;t start on this device. The picture shows the plan.</div>}
            {gated && (
              <button type="button" className={po.gate} onClick={() => setLocked(false)}>
                <span>Tap to explore in 3D</span>
              </button>
            )}
            {coarse && !locked && isReady && (
              <button type="button" className={po.done} onClick={() => setLocked(true)}>
                Done
              </button>
            )}
          </div>
          <div className={styles.viewActions}>
            <button type="button" className={isChosen(viewing.key) ? styles.addOn : styles.add} aria-pressed={isChosen(viewing.key)} onClick={() => toggle(viewing.key)}>
              {isChosen(viewing.key) ? "In your selection ✓" : "Add to your selection"}
            </button>
            {isReady && (
              <button type="button" className={po.full} onClick={() => viewerRef.current?.toggleFullscreen?.()}>
                Full screen
              </button>
            )}
          </div>
          <p className={po.hint}>
            Drag to turn it, scroll to zoom, and use the buttons to step inside or switch day and night. An illustrative model: furniture and finishes
            are indicative, and dimensions are approximate.
          </p>
        </section>

        <section className={styles.chooser} aria-label="The homes to choose from">
          {groups.map((g) => (
            <div key={g.name} className={styles.group}>
              <h2 className={styles.groupTitle}>
                {g.name}
                {g.note && <span className={styles.groupNote}>{g.note}</span>}
              </h2>
              <ul className={styles.cards}>
                {g.items.map((p) => (
                  <li key={p.key} className={`${styles.card} ${isChosen(p.key) ? styles.cardOn : ""} ${p.key === viewing.key ? styles.cardViewing : ""}`}>
                    <button type="button" className={styles.cardView} aria-pressed={p.key === viewing.key} onClick={() => show(p.key)}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a small plain picture of the home from above */}
                      <img className={styles.thumb} src={p.poster} alt="" loading="lazy" />
                      <span className={styles.cardText}>
                        <b>{p.title}</b>
                        <span className={styles.chip}>{p.floorLabel}</span>
                        <span className={styles.size}>{sizeOf(p)}</span>
                        <span className={styles.see}>{p.key === viewing.key ? "Showing in 3D" : "View in 3D"}</span>
                      </span>
                    </button>
                    <div className={styles.buy}>
                      <span className={styles.money}>
                        {savingOf(p.listPriceUSD, p.priceUSD) > 0 && <s>{formatUSD(p.listPriceUSD ?? 0)}</s>}
                        <b>{formatUSD(p.priceUSD)}</b>
                      </span>
                      <label className={isChosen(p.key) ? styles.pickOn : styles.pick}>
                        <input type="checkbox" checked={isChosen(p.key)} onChange={() => toggle(p.key)} />
                        <span>{isChosen(p.key) ? "Selected" : "Select"}</span>
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <section ref={totalRef} className={styles.total} aria-labelledby="pick-total">
            <h2 id="pick-total" className={styles.groupTitle}>
              Your selection
            </h2>
            {mine.length === 0 ? (
              <p className={po.note}>Nothing ticked yet. Press Select on a home to see your price.</p>
            ) : (
              <div className={styles.summary}>
                <ul className={styles.lines}>
                  {mine.map((p) => (
                    <li key={p.key}>
                      <span>
                        {p.title}, {p.floorLabel.toLowerCase()}
                      </span>
                      <b>{formatUSD(p.priceUSD)}</b>
                    </li>
                  ))}
                </ul>
                <dl className={styles.totals}>
                  {totalList !== null && totalSaving > 0 && (
                    <div>
                      <dt>List price</dt>
                      <dd className={po.struck}>{formatUSD(totalList)}</dd>
                    </div>
                  )}
                  <div className={styles.grand}>
                    <dt>Your price{mine.length > 1 ? ` for the ${mine.length} homes` : ""}</dt>
                    <dd>{formatUSD(total)}</dd>
                  </div>
                  {totalList !== null && totalSaving > 0 && (
                    <div className={styles.saved}>
                      <dt>Your discount</dt>
                      <dd>
                        −{formatUSD(totalSaving)} <small>({Math.round((totalSaving / totalList) * 1000) / 10}% off)</small>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </section>
        </section>
      </div>

      {/* Always on screen: what is selected and what it comes to. */}
      <div className={styles.bar} role="status" aria-live="polite">
        <button type="button" className={styles.barText} onClick={() => totalRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>
          <span className={styles.barCount}>{mine.length === 0 ? "No home selected yet" : mine.length === 1 ? "1 home selected" : `${mine.length} homes selected`}</span>
          <span className={styles.barNames}>{mine.length === 0 ? "Press Select on a home" : mine.map((p) => (p.group === "studio" ? `${p.title} (${p.floorLabel.toLowerCase()})` : p.title)).join(" + ")}</span>
        </button>
        {mine.length > 0 && (
          <div className={styles.barPrice}>
            <span className={styles.barLabel}>Total</span>
            <b>{formatUSD(total)}</b>
          </div>
        )}
      </div>
    </div>
  );
}
