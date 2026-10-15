import type { KeyboardEvent } from "react";

/**
 * On a phone keypad, "Next" (Enter) moves to the next number box in the same block,
 * so a line can be taped without closing the keyboard. The last box just closes it.
 */
export function nextOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const scope = e.currentTarget.closest("[data-tape-scope]") ?? document;
  const boxes = Array.from(scope.querySelectorAll<HTMLInputElement>("input:not([disabled])"));
  const next = boxes[boxes.indexOf(e.currentTarget) + 1];
  if (next) next.focus();
  else e.currentTarget.blur();
}

/** Props for a whole-millimetre box: the big number keypad, with Next. */
export const MM_INPUT = {
  inputMode: "numeric",
  pattern: "[0-9]*",
  enterKeyHint: "next",
  onKeyDown: nextOnEnter,
} as const;
