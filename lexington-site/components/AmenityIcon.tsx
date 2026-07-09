const ICONS: Record<string, React.ReactNode> = {
  garden: (
    <path d="M12 21V11M12 11c0-4 3-7 7-7 0 4-3 7-7 7Zm0 0C12 7 9 4 5 4c0 4 3 7 7 7Z" />
  ),
  pool: (
    <path d="M3 17c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0M3 12c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0M8 8l2-4 2 4" />
  ),
  gym: (
    <path d="M4 12h2m12 0h2M8 8v8m8-8v8M6 9v6m12-6v6M8 12h8" />
  ),
  sauna: (
    <path d="M8 12c0-2 2-3 2-5s-1-3-1-3 3 1 3 4-2 3-2 5 1 3 1 3-3-1-3-4Zm6 0c0-1.3 1.2-2 1.2-3.3S14 6 14 6s2 .7 2 2.7-1.2 2-1.2 3.3.8 2 .8 2-2.6-.7-2.6-2Z" />
  ),
  jacuzzi: (
    <path d="M4 16h16M6 16v-2a2 2 0 1 1 4 0v2M12 16v-4a2 2 0 1 1 4 0v4M9 6c.5.6.5 1.4 0 2M13 6c.5.6.5 1.4 0 2" />
  ),
  ice: (
    <path d="M12 2v20M5 6.5l14 11M19 6.5 5 17.5M12 2l-2 2m2-2 2 2M12 22l-2-2m2 2 2-2M5 6.5l2.5.5M5 6.5l.5-2.5M19 6.5l-2.5.5M19 6.5l-.5-2.5M5 17.5l.5 2.5M5 17.5l2.5-.5M19 17.5l-.5 2.5M19 17.5l-2.5-.5" />
  ),
  cafe: (
    <path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm13 2h1.5a2.5 2.5 0 0 1 0 5H17M8 3c-.5.6-.5 1.4 0 2M12 3c-.5.6-.5 1.4 0 2" />
  ),
};

function pickIcon(name: string) {
  const key = name.toLowerCase();
  if (key.includes("garden")) return ICONS.garden;
  if (key.includes("pool")) return ICONS.pool;
  if (key.includes("gym")) return ICONS.gym;
  if (key.includes("sauna")) return ICONS.sauna;
  if (key.includes("jacuzzi")) return ICONS.jacuzzi;
  if (key.includes("ice")) return ICONS.ice;
  if (key.includes("caf")) return ICONS.cafe;
  return ICONS.garden;
}

export function AmenityIcon({ name }: { name: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {pickIcon(name)}
    </svg>
  );
}
