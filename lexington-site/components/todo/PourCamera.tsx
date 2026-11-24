"use client";

import { useEffect, useRef, useState } from "react";

import { PHOTO_KIND_NAMES, PHOTO_KINDS, type PourPhotoKind } from "@/lib/concrete/pourExtras";
import ps from "./Pours.module.css";
import { keepAwake } from "./wakeLock";

// The app's own camera for pre-pour photos (Niko, 24 Nov 2026: "taking photos only uploads one at a time and i wanted
// to take photo after photo. i need about 20 photos to do the entire slab"). The phone's camera, opened from a web page,
// takes one photo and closes; this one stays open: each tap is a photo, as big as the camera gives a web page, and it
// starts going up at once (pourPhotoQueue.ts) while the next one is taken. Where it can't open (not allowed, or no
// camera), the phone's own camera still can, one photo at a time.

export interface Shot {
  file: File;
  /** The copy to look at, made there and then, with the photo's own size. */
  small: { blob: Blob; width: number; height: number };
}

/** As big as an iPhone's own photos; the camera gives the nearest it can. */
const ASK: MediaTrackConstraints = { facingMode: { ideal: "environment" }, width: { ideal: 4032 }, height: { ideal: 3024 } };
/** The copy to look at: as the picked photos' (pourPhotoQueue.ts). */
const SMALL = 1280;

/**
 * An iPhone asks before the app may know how the phone is held (so a photo taken with it turned sideways comes out
 * upright): asked on the tap that opens the camera, as it must be. Elsewhere it's simply known.
 */
export function askHowHeld() {
  const D = (typeof DeviceOrientationEvent === "undefined" ? null : DeviceOrientationEvent) as unknown as { requestPermission?: () => Promise<string> } | null;
  if (typeof D?.requestPermission === "function") void D.requestPermission().catch(() => undefined);
}

/** How far round (clockwise) the screen's picture is turned with the phone: 0 when the app stands upright. */
function screenTurn(): number {
  const angle = typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle : ((window as { orientation?: number }).orientation ?? 0);
  return (360 - (((angle % 360) + 360) % 360)) % 360;
}

/** A real picture from the camera (as it starts, a camera can show a tiny blank one first). */
const sized = (v: HTMLVideoElement) => v.videoWidth >= 160 && v.videoHeight >= 120;

/**
 * Waits until the camera shows its picture at the size it said it would (a camera can start small and grow), or, after
 * a few seconds, any real picture at all; false when there's none.
 */
function pictureFrom(v: HTMLVideoElement, track: MediaStreamTrack | undefined, isClosed: () => boolean): Promise<boolean> {
  const said = track?.getSettings?.() ?? {};
  const full = () => sized(v) && (!said.width || !said.height || Math.max(v.videoWidth, v.videoHeight) >= Math.max(said.width, said.height));
  return new Promise((resolve) => {
    const started = Date.now();
    const look = () => {
      if (isClosed()) return resolve(false);
      if (full() || (sized(v) && Date.now() - started > 3000)) return resolve(true);
      if (Date.now() - started > 10_000) return resolve(false);
      setTimeout(look, 100);
    };
    look();
  });
}

const jpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo could not be made."))), "image/jpeg", quality));

export function PourCamera({
  kind,
  onKind,
  onShot,
  going,
  failed,
  phoneCamera,
  onClose,
}: {
  kind: PourPhotoKind;
  onKind: (kind: PourPhotoKind) => void;
  onShot: (shot: Shot, kind: PourPhotoKind) => void;
  /** This pour's photos still going up, and those that didn't. */
  going: number;
  failed: number;
  /** The id of the phone's own camera (one photo at a time), for when this one can't open. */
  phoneCamera: string;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"opening" | "ready" | "blocked" | "none">("opening");
  const [taken, setTaken] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [trouble, setTrouble] = useState<string | null>(null);
  // How the phone is held (clockwise from upright), from its motion sensor; null until known.
  const held = useRef<number | null>(null);
  // One photo made at a time (a big one is a lot for a phone); a quick second tap waits its turn.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const canvases = useRef<{ big: HTMLCanvasElement; small: HTMLCanvasElement } | null>(null);
  const shotTo = useRef(onShot);
  useEffect(() => {
    shotTo.current = onShot;
  }, [onShot]);
  // Closed with a photo still being made: it still goes up, but there's no screen left to show it on.
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);

  // The camera: opened now, again when the app comes back to it (a phone stops it while the app is away), and
  // stopped (its light off) when this closes, once the photos tapped just before are made.
  useEffect(() => {
    const making = chain;
    const drawing = canvases;
    let closed = false;
    let stream: MediaStream | null = null;
    const stop = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setState("none");
      try {
        const got = await navigator.mediaDevices.getUserMedia({ audio: false, video: ASK });
        if (closed) return got.getTracks().forEach((t) => t.stop());
        stop();
        stream = got;
        const v = video.current;
        if (!v) return;
        v.srcObject = got;
        await v.play().catch(() => undefined);
        const showing = await pictureFrom(v, got.getVideoTracks()[0], () => closed);
        if (!closed) setState(showing ? "ready" : "none");
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        if (!closed) setState(name === "NotAllowedError" || name === "SecurityError" ? "blocked" : "none");
      }
    };
    const back = () => {
      if (document.visibilityState !== "visible" || stream?.getVideoTracks().some((t) => t.readyState === "live")) return;
      setState("opening");
      void start();
    };
    void start();
    document.addEventListener("visibilitychange", back);
    keepAwake("pour camera", true);
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", back);
      keepAwake("pour camera", false);
      void making.current.finally(() => {
        stop();
        // An iPhone frees a canvas's memory only when told.
        for (const c of drawing.current ? [drawing.current.big, drawing.current.small] : []) {
          c.width = 0;
          c.height = 0;
        }
        drawing.current = null;
      });
    };
  }, []);

  // How the phone is held: "up" across the screen's face (right +) and along it (top +). Held nearly flat (pointing
  // down at the slab) says nothing, so the last way it was held stands, as on the phone's own camera.
  useEffect(() => {
    const onTurn = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      const beta = (e.beta * Math.PI) / 180;
      const gamma = (e.gamma * Math.PI) / 180;
      const across = -Math.sin(gamma) * Math.cos(beta);
      const along = Math.sin(beta);
      if (Math.hypot(across, along) < 0.35) return;
      held.current = Math.abs(along) >= Math.abs(across) ? (along > 0 ? 0 : 180) : across < 0 ? 90 : 270;
    };
    window.addEventListener("deviceorientation", onTurn);
    return () => window.removeEventListener("deviceorientation", onTurn);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => {
    if (last) URL.revokeObjectURL(last);
  }, [last]);

  const shoot = () => {
    const v = video.current;
    if (state !== "ready" || !v || !sized(v)) return;
    setFlash((n) => n + 1);
    setTrouble(null);
    const what = kind;
    // Turned from how the app shows it (the camera's picture follows the app, not the phone).
    const turn = held.current === null ? 0 : (held.current - screenTurn() + 360) % 360;
    chain.current = chain.current
      .then(async () => {
        const shot = await capture(v, turn, Date.now());
        if (!shot) return;
        shotTo.current(shot, what);
        if (gone.current) return;
        setTaken((n) => n + 1);
        setLast(URL.createObjectURL(shot.small.blob));
      })
      .catch(() => setTrouble("That photo didn't take. Try again."));
  };

  async function capture(v: HTMLVideoElement, turn: number, at: number): Promise<Shot | null> {
    if (!sized(v)) return null;
    // An iPhone makes no picture over about 16.7 million pixels: a bigger camera picture is made a little smaller.
    const fit = Math.min(1, Math.sqrt(16_000_000 / (v.videoWidth * v.videoHeight)));
    const vw = Math.round(v.videoWidth * fit);
    const vh = Math.round(v.videoHeight * fit);
    const sideways = turn === 90 || turn === 270;
    const width = sideways ? vh : vw;
    const height = sideways ? vw : vh;
    canvases.current ??= { big: document.createElement("canvas"), small: document.createElement("canvas") };
    const { big, small } = canvases.current;
    big.width = width;
    big.height = height;
    const g = big.getContext("2d")!;
    if (turn === 90) {
      g.translate(width, 0);
      g.rotate(Math.PI / 2);
    } else if (turn === 180) {
      g.translate(width, height);
      g.rotate(Math.PI);
    } else if (turn === 270) {
      g.translate(0, height);
      g.rotate(-Math.PI / 2);
    }
    g.drawImage(v, 0, 0, vw, vh);
    const scale = Math.min(1, SMALL / Math.max(width, height));
    small.width = Math.round(width * scale);
    small.height = Math.round(height * scale);
    small.getContext("2d")!.drawImage(big, 0, 0, small.width, small.height);
    const [full, copy] = await Promise.all([jpeg(big, 0.92), jpeg(small, 0.74)]);
    return { file: new File([full], `camera-${at}.jpg`, { type: "image/jpeg", lastModified: at }), small: { blob: copy, width, height } };
  }

  const status = failed > 0 ? `${failed} didn’t go up` : going > 0 ? `${going} going up` : taken > 0 ? "All in ✓" : "";

  return (
    <div className={ps.camera} role="dialog" aria-modal="true" aria-label="Camera">
      <div className={ps.cameraTop}>
        <div className={ps.cameraKinds} role="group" aria-label="What the next photos show">
          {PHOTO_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => onKind(k)}>
              {PHOTO_KIND_NAMES[k]}
            </button>
          ))}
        </div>
        {status && (
          <p className={failed > 0 ? `${ps.cameraState} ${ps.cameraStateBad}` : ps.cameraState} role="status">
            {status}
          </p>
        )}
      </div>
      <div className={ps.cameraView}>
        <video ref={video} playsInline muted autoPlay disablePictureInPicture aria-label="What the camera sees" />
        {flash > 0 && <span key={flash} className={ps.cameraFlash} aria-hidden="true" />}
        {state === "opening" && <p className={ps.cameraNote}>Opening the camera…</p>}
        {(state === "blocked" || state === "none") && (
          <div className={ps.cameraNote} role="alert">
            <p>
              {state === "blocked"
                ? "The app isn’t allowed to use the camera. Allow it in your phone’s settings, or use the phone’s own camera (one photo at a time)."
                : "The camera didn’t open here. Use the phone’s own camera instead (one photo at a time)."}
            </p>
            <label htmlFor={phoneCamera} className={ps.cameraPhone} role="button" tabIndex={0}>
              Use the phone’s camera
            </label>
          </div>
        )}
        {state === "ready" && taken === 0 && !trouble && <p className={ps.cameraHint}>Tap the button for each photo, then Done.</p>}
        {trouble && (
          <p className={ps.cameraHint} role="alert">
            {trouble}
          </p>
        )}
      </div>
      <div className={ps.cameraBar}>
        <div className={ps.cameraLast} aria-live="polite">
          {last && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- the photo just taken, on the phone */}
              <img src={last} alt="" />
              <span className={ps.cameraCount} aria-label={`${taken} taken`}>
                {taken}
              </span>
            </>
          )}
        </div>
        <button type="button" className={ps.shutter} onClick={shoot} disabled={state !== "ready"} aria-label="Take a photo" />
        <button type="button" className={ps.cameraDone} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
