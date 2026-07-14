"use client";

import { useEffect, useRef, useState } from "react";

import { LEXINGTON_COORDS } from "@/lib/maps";
import styles from "./InteractiveMap.module.css";

// Minimal shape for the one script-tag-loaded global we use — avoids
// pulling in @types/google.maps for a single small component.
interface MinimalGoogleMaps {
  maps: {
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => unknown;
    Marker: new (opts: Record<string, unknown>) => unknown;
  };
}

declare global {
  interface Window {
    google?: MinimalGoogleMaps;
  }
}

let mapsScriptPromise: Promise<void> | null = null;

function loadMapsScript(apiKey: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (mapsScriptPromise) return mapsScriptPromise;

  mapsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });

  return mapsScriptPromise;
}

interface InteractiveMapProps {
  // Breaks the map out of the page's centered `.wrap` container so it
  // spans the full viewport width, edge to edge, instead of staying
  // inside the normal content column.
  fullBleed?: boolean;
}

export function InteractiveMap({ fullBleed }: InteractiveMapProps = {}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [status, setStatus] = useState<"loading" | "ready" | "error">(apiKey ? "loading" : "error");

  useEffect(() => {
    if (!apiKey) return;

    let cancelled = false;
    loadMapsScript(apiKey)
      .then(() => {
        if (cancelled || !mapRef.current || !window.google) return;

        const map = new window.google.maps.Map(mapRef.current, {
          center: LEXINGTON_COORDS,
          zoom: 14,
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
        });

        new window.google.maps.Marker({
          position: LEXINGTON_COORDS,
          map,
          title: "The Lexington",
        });

        setStatus("ready");
      })
      .catch(() => setStatus("error"));

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  if (status === "error") {
    return (
      <a
        className={`${styles.fallback} ${fullBleed ? styles.fullBleed : ""}`}
        href="https://maps.app.goo.gl/uJrGXZyWzEhxBKRD6"
        target="_blank"
        rel="noopener noreferrer"
      >
        View The Lexington on Google Maps
      </a>
    );
  }

  return (
    <div
      ref={mapRef}
      className={`${styles.map} ${fullBleed ? styles.fullBleed : ""}`}
      aria-label="Map showing The Lexington's location in Shiashie, East Legon"
    />
  );
}
