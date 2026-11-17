"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { confirmPlanPicksAction } from "@/lib/actions/planPicks";
import { formatUSD } from "@/lib/format";
import { SITE_VIEWER_SRC } from "@/lib/models3d";
import { portalDay, type PickConfirmView, type PickViewer, type PlanPickView } from "@/lib/planOptions";
import po from "./PlanOptions.module.css";
import styles from "./PlanPicker.module.css";

// Homes a buyer can pick from (Niko, 16 Nov 2026: a buyer who wants separate homes on different floors looks at each one
// in 3D, ticks the ones he wants and sees his price add up). Laid out so it explains itself (his word, later that day:
// "make it better and more intuitive to use"): the homes are cards with a picture; a tap on a card shows that home in
// the 3D view, which stays beside the cards on a wide screen; "Select" on a card adds it; the price is always on screen
// in a bar at the bottom.
// The models are one self-contained script in /public/3d, built from the penthouse-3d project (build-offerpick.mjs); it
// is only downloaded on this page. Bump the number after the script is rebuilt so browsers fetch the new one.
// When every home is one of the Residences page's, that page's own script shows them instead (lib/planOptions.ts).
// Since 17 Nov 2026 an account can also have a "Confirm my selection" button (`confirm`): it sends the ticked homes
// to Niko (lib/actions/planPicks.ts) and the page says so; a different selection can be sent afterwards.
const VIEWERS: Record<PickViewer, { src: string; global: "LEXPICK" | "PH2B" }> = {
  pick: { src: "/3d/offerpick.iife.js?v=5", global: "LEXPICK" },
  site: { src: SITE_VIEWER_SRC, global: "PH2B" },
};

export type { PlanPickView } from "@/lib/planOptions";

interface Viewer {
  dispose: () => void;
  toggleFullscreen?: () => void;
}
interface ViewerApi {
  mountUnit: (host: HTMLElement, id: string, options: Record<string, unknown>) => Promise<Viewer>;
}

const pending: Partial<Record<PickViewer, Promise<ViewerApi>>> = {};

function loadViewer(kind: PickViewer): Promise<ViewerApi> {
  const { src, global } = VIEWERS[kind];
  const w = window as unknown as Partial<Record<"LEXPICK" | "PH2B", ViewerApi>>;
  const ready = w[global];
  if (ready) return Promise.resolve(ready);
  pending[kind] ??= new Promise<ViewerApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      const api = w[global];
      if (api) resolve(api);
      else reject(new Error("3D viewer did not start"));
    };
    script.onerror = () => {
      delete pending[kind];
      reject(new Error("3D viewer could not be loaded"));
    };
    document.head.appendChild(script);
  });
  return pending[kind];
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
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));

export function PlanPicker({ picks, viewer = "pick", confirm = null }: { picks: PlanPickView[]; viewer?: PickViewer; confirm?: PickConfirmView | null }) {
  const [viewKey, setViewKey] = useState(picks[0].key);
  // Ticked when the page opens: what the buyer last sent, or else the homes marked on the account.
  const [chosen, setChosen] = useState<string[]>(() => confirm?.sent?.keys ?? picks.filter((p) => p.preselected).map((p) => p.key));
  const [sent, setSent] = useState(confirm?.sent ?? null);
  const [sending, startSending] = useTransition();
  const [problem, setProblem] = useState("");
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

    loadViewer(viewer)
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
  }, [viewing.model, viewer]);

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
  // A page of studios only says "studio"; one with a main home says "home".
  const one = picks.every((p) => p.group === "studio") ? "studio" : "home";
  const many = (n: number) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const nameOf = (p: PlanPickView) => p.unitNumber || p.title;

  // The "Confirm my selection" button, on accounts that have one.
  const need = confirm?.count ?? null;
  const countOk = need ? mine.length === need : mine.length > 0;
  const isSent = !!sent && sameSet(sent.keys, chosen);
  const sentNames = sent ? picks.filter((p) => sent.keys.includes(p.key)).map(nameOf).join(" + ") : "";
  const countHint = !need
    ? `Select a ${one} first.`
    : mine.length < need
      ? `Select ${need - mine.length} more ${one}${need - mine.length === 1 ? "" : "s"} to confirm.`
      : `Please keep ${many(need)}: untick ${mine.length - need}.`;
  const sendLabel = sending ? "Sending…" : isSent ? "Sent ✓" : sent ? "Send my new selection" : "Confirm my selection";
  const send = () => {
    if (sending || isSent || !countOk) return;
    setProblem("");
    startSending(async () => {
      try {
        const result = await confirmPlanPicksAction(chosen);
        if (result.status === "ok" && result.keys && result.at) setSent({ keys: result.keys, at: result.at });
        else setProblem(result.message ?? "Sorry, your selection could not be sent. Please try again, or contact us.");
      } catch {
        setProblem("Sorry, your selection could not be sent. Please check your connection and try again.");
      }
    });
  };

  const groups: { name: string; note?: string; items: PlanPickView[] }[] = [
    { name: "Your home", items: picks.filter((p) => p.group === "home") },
    { name: "Studios", note: "Lower floors cost less.", items: picks.filter((p) => p.group === "studio") },
  ].filter((g) => g.items.length > 0);

  return (
    <div className={styles.wrap}>
      <ol className={styles.steps} aria-label="How this page works">
        <li>
          <b>1</b> Tap a {one} to see it in 3D
        </li>
        <li>
          <b>2</b> Press Select on {need ? `your ${many(need)}` : `the ${one}s you want`}
        </li>
        <li>
          <b>3</b> {confirm ? "Press Confirm at the bottom to send it to us" : "Your price is at the bottom of the screen"}
        </li>
      </ol>

      {confirm && sent && (
        <p className={styles.sentBox} role="status">
          <b>
            ✓ You sent us your selection on {portalDay(sent.at)}: {sentNames}.
          </b>{" "}
          We will be in touch to update your agreement. To change it, choose again below and press &ldquo;Send my new selection&rdquo;.
        </p>
      )}

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
              <p className={po.note}>Nothing ticked yet. Press Select on a {one} to see your price.</p>
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
                    <dt>Your price{mine.length > 1 ? ` for the ${many(mine.length)}` : ""}</dt>
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
            {confirm && (
              <div className={styles.confirm}>
                <button type="button" className={styles.confirmBtn} disabled={sending || isSent || !countOk} onClick={send}>
                  {sendLabel}
                </button>
                {problem ? (
                  <p className={styles.confirmProblem} role="alert">
                    {problem}
                  </p>
                ) : isSent ? (
                  <p className={styles.confirmNote} role="status">
                    Thank you. We have your selection and will be in touch to update your agreement.
                  </p>
                ) : !countOk ? (
                  <p className={styles.confirmNote}>{countHint}</p>
                ) : (
                  <p className={styles.confirmNote}>
                    {sent ? "This replaces the selection you sent before. " : ""}Pressing the button sends your selection to us. We will then be in touch to
                    update your agreement.
                  </p>
                )}
              </div>
            )}
          </section>
        </section>
      </div>

      {/* Always on screen: what is selected and what it comes to. */}
      <div className={confirm ? `${styles.bar} ${styles.barConfirm}` : styles.bar} role="status" aria-live="polite">
        <button type="button" className={styles.barText} onClick={() => totalRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>
          <span className={styles.barCount}>{mine.length === 0 ? `No ${one} selected yet` : `${many(mine.length)} selected`}</span>
          <span className={styles.barNames}>{mine.length === 0 ? `Press Select on a ${one}` : mine.map((p) => (p.group === "studio" ? `${p.title} (${p.floorLabel.toLowerCase()})` : p.title)).join(" + ")}</span>
        </button>
        {mine.length > 0 && (
          <div className={styles.barPrice}>
            <span className={styles.barLabel}>Total</span>
            <b>{formatUSD(total)}</b>
          </div>
        )}
        {confirm && (
          <button type="button" className={styles.barBtn} disabled={sending || isSent || !countOk} onClick={send} title={!countOk ? countHint : undefined}>
            {!countOk && need ? (mine.length < need ? `Select ${need - mine.length} more` : `Keep only ${need}`) : sendLabel}
          </button>
        )}
      </div>
    </div>
  );
}
