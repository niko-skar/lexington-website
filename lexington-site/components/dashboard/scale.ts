/** A clean top for a chart's axis: 1, 2, 4, 5 or 10 times a power of ten, at least `max`. */
export function niceTop(max: number, integer: boolean): number {
  if (!(max > 0)) return integer ? 2 : 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 4, 5, 10]) {
    const top = step * magnitude;
    if (top >= max) return integer ? Math.max(2, Math.ceil(top)) : top;
  }
  return 10 * magnitude;
}
