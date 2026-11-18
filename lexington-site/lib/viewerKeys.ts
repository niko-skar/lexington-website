// Moving a 3D model's camera with the keyboard (Niko, 18 Nov 2026: "with all 3d models let me use the arrows or wasd to move
// the camera point around since my touch on my laptop is disabled").
//
// The 3D viewers (public/3d/*.iife.js, built from penthouse-3d) turn and zoom with a mouse or fingers, and walk with W A S D
// only inside "walk" mode. This adds, for the overview: arrows or W A S D slide the point the camera looks at (forward, back,
// left, right, as the camera faces), Q and E turn round it, + and - (or R and F, Page Up and Page Down) zoom, Shift goes
// faster. It works from the website's side, through the camera and controls each viewer hands back (`_debug`), so the
// viewer scripts themselves are unchanged.
//
// Keys reach a model while the mouse is over it, once it has been clicked (it keeps the focus), or always (`always`) for a
// full-screen one. Typing in a form field is never taken over, nor anything with Ctrl, Alt or the Windows / Cmd key.

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface ViewerInside {
  state?: { mode?: string; autoRotate?: boolean; userTouched?: boolean; tween?: unknown };
  stopTour?: () => void;
  _debug?: {
    camera?: { position: Vec3; matrixWorld: { elements: ArrayLike<number> } };
    controls?: { target: Vec3; minDistance: number; maxDistance: number; update: () => void };
    walk?: { key: (code: string, down: boolean) => void; stop?: () => void };
    ui?: { showHint?: (text: string, ms?: number) => void; hideHint?: () => void };
  };
}

const MOVE: Record<string, [number, number]> = {
  KeyW: [1, 0],
  ArrowUp: [1, 0],
  KeyS: [-1, 0],
  ArrowDown: [-1, 0],
  KeyA: [0, -1],
  ArrowLeft: [0, -1],
  KeyD: [0, 1],
  ArrowRight: [0, 1],
};
const TURN: Record<string, number> = { KeyQ: -1, KeyE: 1 };
const ZOOM: Record<string, number> = { Equal: 1, NumpadAdd: 1, KeyR: 1, PageUp: 1, Minus: -1, NumpadSubtract: -1, KeyF: -1, PageDown: -1 };
// what walk mode understands (the viewer's own keys)
const WALK = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);

export const KEYS_HINT = "Keys: arrows or W A S D move · Q E turn · + − zoom · Shift faster";

const typing = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

export function attachViewerKeys(host: HTMLElement, viewer: unknown, { always = false }: { always?: boolean } = {}): () => void {
  const v = viewer as ViewerInside;
  const cam = v._debug?.camera;
  const controls = v._debug?.controls;
  if (!cam || !controls) return () => {};

  let hover = false;
  let hinted = false;
  const held = new Set<string>();
  let shift = false;
  let raf = 0;
  let last = 0;

  const active = () => always || hover || host.contains(document.activeElement);
  const inWalk = () => v.state?.mode === "walk";

  function step(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    if (!held.size || inWalk()) {
      raf = 0;
      return;
    }
    const p = cam!.position;
    const t = controls!.target;
    let ox = p.x - t.x,
      oy = p.y - t.y,
      oz = p.z - t.z;
    const dist = Math.hypot(ox, oy, oz) || 1;
    const fast = shift ? 2.5 : 1;
    let f = 0,
      s = 0,
      turn = 0,
      zoom = 0;
    for (const code of held) {
      if (MOVE[code]) {
        f += MOVE[code][0];
        s += MOVE[code][1];
      }
      if (TURN[code]) turn += TURN[code];
      if (ZOOM[code]) zoom += ZOOM[code];
    }
    // slide: along the camera's own right (always level with the floor here) and the level direction it faces
    if (f || s) {
      const e = cam!.matrixWorld.elements;
      let rx = e[0],
        rz = e[2];
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl;
      rz /= rl;
      const fx = rz,
        fz = -rx; // forward on the floor = the right turned a quarter to the left
      const len = Math.hypot(f, s) || 1;
      const d = Math.max(1.2, dist * 0.45) * fast * dt;
      const mx = ((fx * f + rx * s) / len) * d,
        mz = ((fz * f + rz * s) / len) * d;
      t.x += mx;
      t.z += mz;
      p.x += mx;
      p.z += mz;
    }
    // turn round the point looked at: Q turns the view to the left (the camera swings round to the right), E to the right
    if (turn) {
      const a = -Math.sign(turn) * 1.3 * fast * dt;
      const c = Math.cos(a),
        sn = Math.sin(a);
      const nx = ox * c + oz * sn,
        nz = -ox * sn + oz * c;
      ox = nx;
      oz = nz;
      p.x = t.x + ox;
      p.z = t.z + oz;
    }
    // zoom: closer or further along the line of sight, within the viewer's own limits
    if (zoom) {
      const want = Math.min(controls!.maxDistance, Math.max(controls!.minDistance, dist * Math.exp(-Math.sign(zoom) * 1.1 * fast * dt)));
      const k = want / dist;
      ox = p.x - t.x;
      oy = p.y - t.y;
      oz = p.z - t.z;
      p.x = t.x + ox * k;
      p.y = t.y + oy * k;
      p.z = t.z + oz * k;
    }
    controls!.update();
    raf = requestAnimationFrame(step);
  }

  function onKey(e: KeyboardEvent, down: boolean) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") shift = down;
    const ours = !!(MOVE[e.code] || TURN[e.code] || ZOOM[e.code]);
    if (!down) {
      held.delete(e.code);
      // walk mode: let go of a key the viewer was given by us
      if (inWalk() && WALK.has(e.code) && !host.contains(document.activeElement)) v._debug?.walk?.key(e.code, false);
      return;
    }
    if (!active() || typing(document.activeElement) || (!ours && !WALK.has(e.code))) return;
    if (inWalk()) {
      // the viewer walks with these itself once it has the focus: give it the focus and pass on this first key
      if (!host.contains(document.activeElement) && WALK.has(e.code)) {
        host.focus({ preventScroll: true });
        v._debug?.walk?.key(e.code, true);
        v._debug?.walk?.stop?.();
        v.stopTour?.();
        e.preventDefault();
      }
      return;
    }
    if (!ours) return;
    e.preventDefault(); // no page scrolling under the model
    if (v.state) {
      v.state.autoRotate = false; // stop the slow sway, any camera glide, the tip
      v.state.userTouched = true;
      v.state.tween = null;
    }
    v._debug?.ui?.hideHint?.();
    held.add(e.code);
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(step);
    }
  }

  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  const blur = () => held.clear();
  const enter = (e: PointerEvent) => {
    hover = true;
    // on a computer (not a touch screen), say once which keys work
    if (!hinted && e.pointerType === "mouse" && !inWalk()) {
      hinted = true;
      v._debug?.ui?.showHint?.(KEYS_HINT, 5000);
    }
  };
  const leave = () => {
    hover = false;
  };
  // a click on the model keeps the keys with it after the mouse moves away
  const down = () => {
    if (!host.contains(document.activeElement)) host.focus({ preventScroll: true });
  };

  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  window.addEventListener("blur", blur);
  host.addEventListener("pointerenter", enter);
  host.addEventListener("pointerleave", leave);
  host.addEventListener("pointerdown", down);

  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
    window.removeEventListener("blur", blur);
    host.removeEventListener("pointerenter", enter);
    host.removeEventListener("pointerleave", leave);
    host.removeEventListener("pointerdown", down);
  };
}
