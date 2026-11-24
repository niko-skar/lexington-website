"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { pushEvent } from "@/lib/analytics";
import { attachViewerKeys } from "@/lib/viewerKeys";
import { Reveal } from "./Reveal";
import { useDialog } from "./useDialog";
import styles from "./Penthouse3D.module.css";
import own from "./Amenities3D.module.css";

// The amenity side of the 1st floor in 3D (24 Nov 2026): the pool hall and café, the gym, the spa (sauna, jacuzzi, ice bath),
// the changing rooms and the lift lobby, as the 1st-floor plan has them. Each amenity can be clicked: the camera turns to it
// and a card gives the website's own line about it and what the plan shows (its size, what is in it, the way in).
// One self-contained script in /public/3d (built from the penthouse-3d project: src/amenities.js, build-site-amenities.mjs),
// only downloaded when someone opens it. Its global is window.LEXAMEN, so it never replaces the homes' script (window.PH2B)
// when a visitor opens both. Bump ?v= after the script is rebuilt, so browsers fetch the new one.
const VIEWER_SRC = "/3d/amenities.iife.js?v=1";
const POSTER_SRC = "/3d/amenities-poster-v1.jpg"; // (a new name for a new picture, not ?v=: next/image refuses query strings on local pictures)

interface Viewer {
  dispose: () => void;
  toggleFullscreen?: () => void;
}
interface ViewerApi {
  mountAmenities: (host: HTMLElement, options: Record<string, unknown>) => Promise<Viewer>;
}
type ViewerEvent = { mode?: string; time?: string; action?: string; id?: string };

let pending: Promise<ViewerApi> | null = null;

function loadViewer(): Promise<ViewerApi> {
  const w = window as unknown as { LEXAMEN?: ViewerApi };
  if (w.LEXAMEN) return Promise.resolve(w.LEXAMEN);
  if (!pending) {
    pending = new Promise<ViewerApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = VIEWER_SRC;
      script.async = true;
      script.onload = () => (w.LEXAMEN ? resolve(w.LEXAMEN) : reject(new Error("3D viewer did not start")));
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
  pushEvent({ event: "model_3d", model: "amenities", action });
}

// Start fetching the script as soon as someone shows interest, so the click feels instant.
function warm() {
  loadViewer().catch(() => {});
}

// ---------------------------------------------------------------------------------------------------------------------
// The full-screen 3D view.
function Amenities3DModal({ onClose }: { onClose: () => void }) {
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
    let detachKeys: (() => void) | null = null;
    let cancelled = false;

    loadViewer()
      .then((api) =>
        api.mountAmenities(host, {
          onClose,
          poster: POSTER_SRC,
          initialTime: "evening", // (as the picture on the page; the sun button switches to daytime)
          cta: { label: "Enquire", href: "/contact" },
          onEvent: (name: string, data?: ViewerEvent) => {
            if (name === "amenity" && data?.id) track(`amenity_${data.id}`);
            else if (name === "amenity_walk" && data?.id) track(`amenity_walk_${data.id}`);
            else if (name === "mode" && data?.mode === "walk") track("walk_inside");
            else if (name === "tour" && data?.action === "start") track("guided_tour");
            else if (name === "time") track(data?.time === "evening" ? "night" : "daytime");
          },
        })
      )
      .then((v) => {
        if (cancelled) v.dispose();
        else {
          viewer = v;
          detachKeys = attachViewerKeys(host, v, { always: true }); // full screen: the keys always move it
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      detachKeys?.();
      viewer?.dispose();
      host.remove();
    };
    // onClose is stable enough for the lifetime of the pop-up; the viewer is started once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={dialogRef} tabIndex={-1} className={own.overlay} role="dialog" aria-modal="true" aria-label="The amenities in 3D">
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
// The section on the Amenities page: the picture opens the 3D view.
export function Amenities3DSection() {
  const [open, setOpen] = useState(false);

  function openViewer() {
    track("open");
    setOpen(true);
  }

  return (
    <section id="amenities-3d" className="section sectionDark">
      <div className={`wrap ${styles.split}`}>
        <Reveal>
          <button
            type="button"
            className={styles.poster}
            onClick={openViewer}
            onPointerEnter={warm}
            onFocus={warm}
            aria-label="Open the amenities in 3D"
          >
            <Image
              src={POSTER_SRC}
              alt="3D model of the amenity floor in the evening: the pool and café, the gym, the spa and the changing rooms"
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
            In 3D
          </div>
          <h2 className={styles.title}>Walk the amenity floor.</h2>
          <div className={styles.body}>
            <p>
              The pool, café, gym, sauna, jacuzzi, ice bath and changing rooms, together on the 1st floor. Click any of them
              to see where it is and read more about it, or walk through the floor yourself.
            </p>
            <p className={styles.note}>
              An illustrative model drawn from the 1st-floor plan. Furniture, equipment and finishes are indicative.
            </p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.cta} onClick={openViewer} onPointerEnter={warm}>
              Explore in 3D
            </button>
          </div>
        </Reveal>
      </div>

      {open && <Amenities3DModal onClose={() => setOpen(false)} />}
    </section>
  );
}
