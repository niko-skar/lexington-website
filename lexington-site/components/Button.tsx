import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./Button.module.css";

type Variant = "clay" | "outline-light" | "outline-dark" | "brass";

interface ButtonProps {
  href: string;
  variant?: Variant;
  children: ReactNode;
  className?: string;
}

const VARIANT_CLASS: Record<Variant, string> = {
  clay: styles.clay,
  "outline-light": styles.outlineLight,
  "outline-dark": styles.outlineDark,
  brass: styles.brass,
};

export function Button({ href, variant = "clay", children, className }: ButtonProps) {
  return (
    <Link
      href={href}
      className={[styles.btn, VARIANT_CLASS[variant], className].filter(Boolean).join(" ")}
    >
      {children}
    </Link>
  );
}
