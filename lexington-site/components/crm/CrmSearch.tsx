"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { stageDef } from "@/lib/crm";
import { internationalDigits } from "@/lib/format";
import styles from "./Crm.module.css";
import { StageChip } from "./StageChip";

export interface SearchEntry {
  id: string;
  name: string;
  stage: string;
  phone?: string;
  email?: string;
  unitNumber?: string;
  interest?: string;
}

const MAX_RESULTS = 8;

// Find anybody from any tab: type a name, number, unit or what they asked
// about. Everything is already on the page, so it answers as you type.
export function CrmSearch({ entries }: { entries: SearchEntry[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const needle = query.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const wanted = digits.length >= 4 ? internationalDigits(needle) : "";
  const matches = needle
    ? entries
        .filter((e) => {
          const text = [e.name, e.email, e.unitNumber, e.interest, e.phone].filter(Boolean).join(" ").toLowerCase();
          if (text.includes(needle)) return true;
          // A phone number is found however it was typed: 0244..., +233 24..., 24 400 0999.
          return wanted !== "" && !!e.phone && internationalDigits(e.phone).includes(wanted);
        })
        .slice(0, MAX_RESULTS)
    : [];

  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={styles.search}>
      <input
        ref={input}
        type="search"
        className={styles.searchInput}
        value={query}
        placeholder="Find a prospect…"
        aria-label="Find a prospect by name, number, unit or what they asked about"
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            close();
            input.current?.blur();
          }
        }}
      />
      {open && needle && (
        // Pressing a result must not take focus off the box, or the list closes before the click lands.
        <div className={styles.searchResults} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {matches.length === 0 ? (
            <div className={styles.searchEmpty}>No one matches “{query.trim()}”.</div>
          ) : (
            matches.map((m) => (
              <Link
                key={m.id}
                href={`/admin/crm/${m.id}`}
                className={styles.searchResult}
                onClick={close}
                role="option"
                aria-selected={false}
              >
                <span className={styles.searchName}>
                  {m.name}
                  <StageChip stage={m.stage} />
                </span>
                <span className={styles.searchSub}>
                  {[m.unitNumber ? `Unit ${m.unitNumber}` : "", m.interest, m.phone].filter(Boolean).join(" · ") ||
                    stageDef(m.stage).label}
                </span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
