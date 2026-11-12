"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { formatUSD } from "@/lib/format";
import styles from "./PlanOptions.module.css";

// The plans a buyer is choosing between, each as a 3D model (Niko, 12 Nov 2026). The models are one self-contained
// script in /public/3d, built from the penthouse-3d project (build-offer4f.mjs); it is only downloaded on this page.
// Bump the number after the script is rebuilt so browsers fetch the new one.
const VIEWER_SRC = "/3d/offer4f.iife.js?v=1";

export interface PlanOptionView {
  key: string;
  title: string;
  /** The model's id in the 3D script. */
  model: string;
  /** The plan seen from straight above: shown until the 3D view is ready. */
  poster: string;
  homes: { name: string; areaSqm: number }[];
  totalSqm: number;
  listPriceUSD: number | null;
  priceUSD: number;
}

export interface DepositView {
  perHomeUSD: number;
  homes: number;
  totalUSD: number;
  paidUSD: number;
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
  const w = window as unknown as { LEX4F?: ViewerApi };
  if (w.LEX4F) return Promise.resolve(w.LEX4F);
  if (!pending) {
    pending = new Promise<ViewerApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = VIEWER_SRC;
      script.async = true;
      script.onload = () => (w.LEX4F ? resolve(w.LEX4F) : reject(new Error("3D viewer did not start")));
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

const sqm = (v: number) => `${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
const saving = (o: PlanOptionView) => (o.listPriceUSD && o.listPriceUSD > o.priceUSD ? o.listPriceUSD - o.priceUSD : 0);
const percent = (o: PlanOptionView) => (o.listPriceUSD ? Math.round((saving(o) / o.listPriceUSD) * 1000) / 10 : 0);

export function PlanOptions({ options, deposit }: { options: PlanOptionView[]; deposit: DepositView | null }) {
  const [key, setKey] = useState(options[0].key);
  const option = options.find((o) => o.key === key) ?? options[0];
  const liveRef = useRef<HTMLDivElement>(null);
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
    host.className = styles.host;
    live.appendChild(host);
    let cancelled = false;
    let errored = false;

    loadViewer()
      .then((api) =>
        api.mountUnit(host, option.model, {
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
        if (errored) setFailed(option.model);
        else setReady(option.model);
      })
      .catch(() => {
        if (!cancelled) setFailed(option.model);
      });

    return () => {
      cancelled = true;
      viewerRef.current?.dispose();
      viewerRef.current = null;
      host.remove();
    };
  }, [option.model]);

  const isReady = ready === option.model;
  const isFailed = failed === option.model;
  const gated = coarse && locked && isReady;
  const remaining = deposit ? Math.max(0, deposit.totalUSD - deposit.paidUSD) : 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.tabs} role="tablist" aria-label="Plan">
        {options.map((o) => (
          <button key={o.key} type="button" role="tab" aria-selected={o.key === option.key} className={o.key === option.key ? styles.tabOn : styles.tab} onClick={() => setKey(o.key)}>
            <span className={styles.tabName}>{o.title}</span>
            <span className={styles.tabPrice}>{formatUSD(o.priceUSD)}</span>
          </button>
        ))}
      </div>

      <div className={styles.split}>
        <div>
          <div className={`${styles.stage} ${isReady ? styles.stageReady : ""}`} role="region" aria-label={`3D model of ${option.title}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a plain picture behind the 3D view, swapped with the plan */}
            <img key={option.poster} className={styles.poster} src={option.poster} alt={`${option.title} seen from straight above`} />
            <div ref={liveRef} className={styles.live} />
            {!isReady && !isFailed && (
              <div className={styles.badge} role="status">
                <span className={styles.spin} aria-hidden="true" />
                Loading the 3D model…
              </div>
            )}
            {isFailed && <div className={styles.badge}>The 3D view can&rsquo;t start on this device. The picture shows the plan.</div>}
            {gated && (
              <button type="button" className={styles.gate} onClick={() => setLocked(false)}>
                <span>Tap to explore in 3D</span>
              </button>
            )}
            {coarse && !locked && isReady && (
              <button type="button" className={styles.done} onClick={() => setLocked(true)}>
                Done
              </button>
            )}
          </div>
          <div className={styles.foot}>
            <p className={styles.hint}>
              Drag to turn it, scroll to zoom, and use the buttons to step inside or switch day and night. An illustrative model: furniture and
              finishes are indicative, and dimensions are approximate.
            </p>
            {isReady && (
              <button type="button" className={styles.full} onClick={() => viewerRef.current?.toggleFullscreen?.()}>
                Full screen
              </button>
            )}
          </div>
        </div>

        <aside className={styles.panel} aria-label={`${option.title}: sizes and price`}>
          <h2 className={styles.panelTitle}>{option.title}</h2>
          <dl className={styles.facts}>
            {option.homes.map((h) => (
              <div key={h.name} className={styles.fact}>
                <dt>{h.name}</dt>
                <dd>{sqm(h.areaSqm)}</dd>
              </div>
            ))}
            <div className={styles.factTotal}>
              <dt>Both homes together</dt>
              <dd>{sqm(option.totalSqm)}</dd>
            </div>
          </dl>
          <dl className={styles.prices}>
            {option.listPriceUSD !== null && saving(option) > 0 && (
              <div className={styles.fact}>
                <dt>List price</dt>
                <dd className={styles.struck}>{formatUSD(option.listPriceUSD)}</dd>
              </div>
            )}
            <div className={styles.priceRow}>
              <dt>Your price</dt>
              <dd>{formatUSD(option.priceUSD)}</dd>
            </div>
            {saving(option) > 0 && (
              <div className={styles.saveRow}>
                <dt>Your discount</dt>
                <dd>
                  −{formatUSD(saving(option))} <small>({percent(option)}% off)</small>
                </dd>
              </div>
            )}
          </dl>
        </aside>
      </div>

      {options.length > 1 && (
        <section className={styles.block} aria-labelledby="plans-side-by-side">
          <h2 id="plans-side-by-side" className={styles.blockTitle}>
            The plans side by side
          </h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Plan</th>
                  <th scope="col">Size</th>
                  <th scope="col">List price</th>
                  <th scope="col">Your price</th>
                  <th scope="col">Your discount</th>
                </tr>
              </thead>
              <tbody>
                {options.map((o) => (
                  <tr key={o.key} className={o.key === option.key ? styles.rowOn : undefined}>
                    <th scope="row">
                      <button type="button" className={styles.rowLink} onClick={() => setKey(o.key)}>
                        {o.title}
                      </button>
                    </th>
                    <td>{sqm(o.totalSqm)}</td>
                    <td>{o.listPriceUSD !== null ? formatUSD(o.listPriceUSD) : "—"}</td>
                    <td className={styles.strong}>{formatUSD(o.priceUSD)}</td>
                    <td>{saving(o) > 0 ? `−${formatUSD(saving(o))} (${percent(o)}%)` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {deposit && (
        <section className={styles.block} aria-labelledby="plans-deposit">
          <h2 id="plans-deposit" className={styles.blockTitle}>
            Deposit
          </h2>
          <div className={styles.deposit}>
            <div className={styles.depositItem}>
              <span>For each home</span>
              <b>{formatUSD(deposit.perHomeUSD)}</b>
            </div>
            <div className={styles.depositItem}>
              <span>
                For the {deposit.homes === 2 ? "two" : deposit.homes} homes
              </span>
              <b>{formatUSD(deposit.totalUSD)}</b>
            </div>
            <div className={styles.depositItem}>
              <span>Received</span>
              <b>{formatUSD(Math.min(deposit.paidUSD, deposit.totalUSD))}</b>
            </div>
            <div className={remaining > 0 ? styles.depositDue : styles.depositItem}>
              <span>Still to pay</span>
              <b>{formatUSD(remaining)}</b>
            </div>
          </div>
          <p className={styles.note}>The deposit is the same for either plan.</p>
        </section>
      )}
    </div>
  );
}
