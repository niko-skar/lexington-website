"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} style={{ minHeight: 36, padding: "0 14px", fontWeight: 600, cursor: "pointer" }}>
      Print / save as PDF
    </button>
  );
}
