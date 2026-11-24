"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { AMENITY_SPOTS } from "@/lib/amenities3d";
import { pushEvent } from "@/lib/analytics";
import { attachViewerKeys } from "@/lib/viewerKeys";
import styles from "./Amenities3D.module.css";

// The Amenities page is built round the amenity floor in 3D (Niko, 24 Nov 2026: "make a plan to change the amenities page and
// focus primarily on this model only", then "3d starts by itself on computers is good"): the pool and café, the gym, the spa
// (sauna, jacuzzi, ice bath), the changing rooms and the lift lobby, from the 1st-floor plan. Each amenity can be clicked: the
// camera turns to it and its card shows its photo, the website's own line about it and what the plan shows.
//   - On a computer the model starts by itself once the page has loaded; on a phone or tablet it waits for a tap, and "Done"
//     hands the fingers back to the page (the picture underneath is the same model, so nothing jumps).
//   - A plain scroll over the model scrolls the page; Ctrl / ⌘ + scroll or a pinch zooms it (the script does that: `inline`).
//   - /amenities#pool (or #cafe, #gym, #sauna, #jacuzzi, #icebath, #changing, #lobby) opens on that amenity's card.
// One self-contained script in /public/3d (built from the penthouse-3d project: src/amenities.js, build-site-amenities.mjs),
// with its own global, window.LEXAMEN, so it never replaces the homes' script (window.PH2B). Bump ?v= after a rebuild.
const VIEWER_SRC = "/3d/amenities.iife.js?v=3"; // v3 (25 Nov 2026): photos in the cards, the website's lines as they are now, scrolling the page over the model
const POSTER_SRC = "/3d/amenities-poster-v2.jpg"; // (a new name for a new picture, not ?v=: next/image refuses query strings on local pictures)

const SPOT_IDS: readonly string[] = AMENITY_SPOTS.map((s) => s.id);

interface Viewer {
  dispose: () => void;
  toggleFullscreen?: () => void;
  select?: (id: string) => void;
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

function warm() {
  loadViewer().catch(() => {});
}

// A computer (a mouse or touchpad on a wide screen) starts the model by itself; a phone or tablet waits for a tap.
const AUTO_QUERY = "(pointer: fine) and (min-width: 900px)";
function useAutoStart() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(AUTO_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(AUTO_QUERY).matches,
    () => false
  );
}

const spotOfHash = () => {
  const h = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  return SPOT_IDS.includes(h) ? h : null;
};

export function Amenities3DStage({
  photos,
  captions,
}: {
  photos: Record<string, string>;
  captions: Record<string, string>;
}) {
  const liveRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const auto = useAutoStart();
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [locked, setLocked] = useState(false); // (phones and tablets: "Done" gives the fingers back to the page)

  // A computer starts it by itself, once the page itself has finished loading.
  useEffect(() => {
    if (!auto || started) return;
    let cancelled = false;
    const go = () => {
      if (cancelled) return;
      setStarted(true);
      track("autostart");
    };
    const idle = () => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(go, { timeout: 1500 });
      else setTimeout(go, 300);
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", idle);
    };
  }, [auto, started]);

  useEffect(() => {
    if (!started) return;
    const live = liveRef.current;
    if (!live) return;
    // A fresh element for every start, so React's double-run of effects in development can't leave two viewers in one box.
    const host = document.createElement("div");
    host.className = styles.host;
    live.appendChild(host);
    let cancelled = false;
    let detachKeys: (() => void) | null = null;
    const onHash = () => {
      const id = spotOfHash();
      if (id) viewerRef.current?.select?.(id);
    };
    setPhase("loading");

    loadViewer()
      .then((api) =>
        api.mountAmenities(host, {
          inline: true,
          hideTitle: true, // (the page's own title is right above)
          initialTime: "evening", // (as the picture underneath; the sun button switches to daytime)
          poster: POSTER_SRC,
          photos,
          captions,
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
        if (cancelled) {
          v.dispose();
          return;
        }
        viewerRef.current = v;
        detachKeys = attachViewerKeys(host, v);
        setPhase("ready");
        onHash(); // (a link to one amenity opens on its card)
        window.addEventListener("hashchange", onHash);
      })
      .catch(() => {
        if (!cancelled) setPhase("failed");
      });

    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHash);
      detachKeys?.();
      viewerRef.current?.dispose();
      viewerRef.current = null;
      host.remove();
    };
    // photos and captions come from the server once; the viewer is started once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  return (
    <div className={styles.block}>
      <div className={`${styles.stage} ${phase === "ready" ? styles.ready : ""}`} data-amenities-stage={phase}>
        <Image
          className={styles.poster}
          src={POSTER_SRC}
          alt="3D model of the amenity floor in the evening: the pool and café, the gym, the spa and the changing rooms"
          fill
          priority
          sizes="(max-width: 1440px) 100vw, 1360px"
        />
        <div ref={liveRef} className={styles.live} />
        {!started && (
          <button
            type="button"
            className={styles.start}
            onClick={() => {
              setStarted(true);
              track("open");
            }}
            onPointerEnter={warm}
            onFocus={warm}
            aria-label="Explore the amenity floor in 3D"
          >
            <span className={styles.play}>
              <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
                <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
              </svg>
              Explore in 3D
            </span>
          </button>
        )}
        {phase === "loading" && (
          <div className={styles.badge} role="status">
            <span className={styles.spin} aria-hidden="true" />
            Loading the 3D model…
          </div>
        )}
        {phase === "failed" && <div className={styles.badge}>The 3D model can&rsquo;t start on this device.</div>}
        {!auto && phase === "ready" && locked && (
          <button
            type="button"
            className={styles.gate}
            onClick={() => {
              setLocked(false);
              track("unlock");
            }}
          >
            <span>Tap to explore in 3D</span>
          </button>
        )}
        {!auto && phase === "ready" && !locked && (
          <button type="button" className={styles.done} onClick={() => setLocked(true)}>
            Done
          </button>
        )}
      </div>
      <p className={styles.foot}>
        Click an amenity, or a pin on the model, to see where it is and read about it. An illustrative model drawn from the
        1st-floor plan: furniture, equipment and finishes are indicative.
      </p>
    </div>
  );
}
