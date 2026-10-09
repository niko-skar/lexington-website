"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { pushEvent } from "@/lib/analytics";
import { Reveal } from "./Reveal";
import { useDialog } from "./useDialog";
import styles from "./Penthouse3D.module.css";

// The 3D model is a self-contained script in /public/3d (built from the penthouse-3d project). It is only
// downloaded when someone asks for it, so the page itself stays as light as before.
// Bump the number after the script is rebuilt so browsers fetch the new one.
const VIEWER_SRC = "/3d/ph2b.iife.js?v=9";
const POSTER_SRC = "/3d/ph2b-poster.jpg";

// The floor plan of each floor as the 3D model itself sees it from straight above (night view), in the two shapes the plan
// box takes. It is on screen the moment the pop-up opens and stays until the live 3D view has started, so there is never an
// empty box: the live view starts from the very same camera and just takes over.
export type PlanLevel = "lower" | "upper";
const PLAN_POSTER: Record<PlanLevel, { wide: string; phone: string }> = {
  lower: { wide: "/3d/ph2b-plan-lower.jpg", phone: "/3d/ph2b-plan-lower-m.jpg" },
  upper: { wide: "/3d/ph2b-plan-upper.jpg", phone: "/3d/ph2b-plan-upper-m.jpg" },
};

// The floor plans of the duplex penthouses are captioned "... lower floor" / "... upper floor (rooftop level)".
export function levelOfPlan(alt: string | undefined): PlanLevel {
  return /upper|rooftop/i.test(alt ?? "") ? "upper" : "lower";
}

interface Viewer {
  dispose: () => void;
  toggleFullscreen?: () => void;
}
interface ViewerApi {
  mountPH2b: (host: HTMLElement, options: Record<string, unknown>) => Promise<Viewer>;
}
type ViewerEvent = { mode?: string; time?: string; action?: string; level?: string; message?: string };

let pending: Promise<ViewerApi> | null = null;

function loadViewer(): Promise<ViewerApi> {
  const w = window as unknown as { PH2B?: ViewerApi };
  if (w.PH2B) return Promise.resolve(w.PH2B);
  if (!pending) {
    pending = new Promise<ViewerApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = VIEWER_SRC;
      script.async = true;
      script.onload = () => (w.PH2B ? resolve(w.PH2B) : reject(new Error("3D viewer did not start")));
      script.onerror = () => {
        pending = null;
        reject(new Error("3D viewer could not be loaded"));
      };
      document.head.appendChild(script);
    });
  }
  return pending;
}

function track(action: string) {
  pushEvent({ event: "model_3d", model: "PH2b", action });
}

// Start fetching the script (and the plan picture) as soon as someone shows interest, so the click feels instant.
export function warm3D(level?: PlanLevel) {
  loadViewer().catch(() => {});
  if (level && typeof window !== "undefined") {
    const phone = window.matchMedia("(max-width: 640px)").matches;
    new window.Image().src = PLAN_POSTER[level][phone ? "phone" : "wide"];
  }
}

// Touch screens: a finger on the 3D view turns the model instead of scrolling the pop-up, so there it starts "locked"
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

// ---------------------------------------------------------------------------------------------------------------------
// The full-screen walk-through opened from the home page.
export function Penthouse3DModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  const stageRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // A fresh element for every start, so React's double-run of effects in development can't leave two viewers in one box.
    const host = document.createElement("div");
    host.className = styles.host;
    stage.appendChild(host);
    let viewer: Viewer | null = null;
    let cancelled = false;

    loadViewer()
      .then((api) =>
        api.mountPH2b(host, {
          onClose,
          poster: POSTER_SRC,
          cta: { label: "Enquire", href: "/contact" },
          onEvent: (name: string, data?: ViewerEvent) => {
            if (name === "mode" && data?.mode === "walk") track("walk_inside");
            else if (name === "tour" && data?.action === "start") track("guided_tour");
            else if (name === "time") track(data?.time === "evening" ? "night" : "daytime");
          },
        })
      )
      .then((v) => {
        if (cancelled) v.dispose();
        else viewer = v;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      viewer?.dispose();
      host.remove();
    };
    // onClose is stable enough for the lifetime of the pop-up; the viewer is started once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="PH2b penthouse, 3D walk-through"
    >
      <div ref={stageRef} className={styles.stage}>
        {failed && (
          <div className={styles.failed}>
            <p>Sorry, the 3D view could not start on this device.</p>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The 3D floor plan inside the PH2b floor-plan pop-up. It opens on the plan picture (the model seen from straight above), the
// 3D view loads behind it, and when that is ready it fades in on the same camera: from then on the visitor can turn it,
// zoom, switch floor, walk inside, switch day and night, or take it full screen.
export function Penthouse3DPlan({ startLevel }: { startLevel: PlanLevel }) {
  const liveRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const coarse = useCoarsePointer();
  const [locked, setLocked] = useState(true); // only matters on touch screens

  useEffect(() => {
    const live = liveRef.current;
    if (!live) return;
    const host = document.createElement("div");
    host.className = styles.planHost;
    live.appendChild(host);
    let cancelled = false;
    let errored = false;
    track("plan_open");

    loadViewer()
      .then((api) =>
        api.mountPH2b(host, {
          initialLevel: startLevel,
          initialView: "top", // the plan view, from straight above
          autoRotate: false,
          hideTitle: true, // the pop-up already says which unit this is
          hideNote: true, // (the caption under the plan box carries the same note)
          compact: window.matchMedia("(max-width: 640px)").matches, // on a phone the small box only gets the floor switch
          onEvent: (name: string, data?: ViewerEvent) => {
            if (cancelled) return;
            if (name === "error") errored = true;
            else if (name === "mode" && data?.mode === "walk") track("plan_walk_inside");
            else if (name === "level") track(`plan_${data?.level}`);
            else if (name === "time") track(data?.time === "evening" ? "plan_night" : "plan_daytime");
          },
        })
      )
      .then((v) => {
        if (cancelled) {
          v.dispose();
          return;
        }
        viewerRef.current = v;
        if (errored) setPhase("failed");
        else {
          setPhase("ready");
          track("plan_ready");
        }
      })
      .catch(() => {
        if (!cancelled) setPhase("failed");
      });

    return () => {
      cancelled = true;
      viewerRef.current?.dispose();
      viewerRef.current = null;
      host.remove();
    };
  }, [startLevel]);

  const gated = coarse && locked && phase === "ready";

  return (
    <div className={styles.plan}>
      <div
        className={`${styles.planStage} ${phase === "ready" ? styles.planReady : ""}`}
        role="region"
        aria-label="3D floor plan of penthouse PH2b"
      >
        <picture className={styles.planPosterWrap}>
          <source media="(max-width: 640px)" srcSet={PLAN_POSTER[startLevel].phone} />
          <img
            className={styles.planPoster}
            src={PLAN_POSTER[startLevel].wide}
            alt={`Floor plan of the ${startLevel} floor of penthouse PH2b, seen from above`}
            fetchPriority="high"
          />
        </picture>
        <div ref={liveRef} className={styles.planLive} />
        {phase === "loading" && (
          <div className={styles.planBadge} role="status">
            <span className={styles.planSpin} aria-hidden="true" />
            Loading the 3D plan…
          </div>
        )}
        {phase === "failed" && <div className={styles.planBadge}>The interactive 3D view can&rsquo;t start on this device.</div>}
        {gated && (
          <button
            type="button"
            className={styles.planGate}
            onClick={() => {
              setLocked(false);
              track("plan_unlock");
            }}
          >
            <span>Tap to explore in 3D</span>
          </button>
        )}
        {coarse && !locked && phase === "ready" && (
          <button type="button" className={styles.planDone} onClick={() => setLocked(true)}>
            Done
          </button>
        )}
      </div>
      <div className={styles.planFoot}>
        <p className={styles.planHint}>
          Drag to turn it, scroll to zoom, use the buttons to change floor or step inside. An illustrative model: furniture, finishes and
          views are indicative, and dimensions are approximate.
        </p>
        {phase === "ready" && (
          <button
            type="button"
            className={styles.planFull}
            onClick={() => {
              track("plan_fullscreen");
              viewerRef.current?.toggleFullscreen?.();
            }}
          >
            Full screen
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
export function Penthouse3DSection({ areaSqm }: { areaSqm?: number }) {
  const [open, setOpen] = useState(false);

  function openViewer() {
    track("open");
    setOpen(true);
  }

  return (
    <section id="walkthrough" className="section sectionDark">
      <div className={`wrap ${styles.split}`}>
        <Reveal>
          <button
            type="button"
            className={styles.poster}
            onClick={openViewer}
            onPointerEnter={() => warm3D()}
            onFocus={() => warm3D()}
            aria-label="Open the 3D walk-through of penthouse PH2b"
          >
            <Image
              src={POSTER_SRC}
              alt="3D model of penthouse PH2b at night: the upper floor with its terrace sitting on the lower floor with the bedrooms"
              width={1600}
              height={1000}
              sizes="(max-width: 880px) 100vw, 55vw"
            />
            <span className={styles.play}>
              <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
                <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
              </svg>
              Explore in 3D
            </span>
          </button>
        </Reveal>

        <Reveal delay={120}>
          <div className="eyebrow" style={{ color: "var(--paper)" }}>
            3D walk-through
          </div>
          <h2 className={styles.title}>Step inside penthouse PH2b.</h2>
          <div className={styles.body}>
            <p>
              PH2b is a three-bedroom duplex penthouse{areaSqm ? ` of ${areaSqm} sqm` : ""}, on two floors.
              Turn the model around, step between the floors, switch between night and day, or walk
              through it yourself and take the stairs.
            </p>
            <p className={styles.note}>
              An illustrative model drawn from the PH2b floor plans. Furniture, finishes and views are
              indicative, and dimensions are approximate.
            </p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.cta} onClick={openViewer} onPointerEnter={() => warm3D()}>
              Explore in 3D
            </button>
          </div>
        </Reveal>
      </div>

      {open && <Penthouse3DModal onClose={() => setOpen(false)} />}
    </section>
  );
}
