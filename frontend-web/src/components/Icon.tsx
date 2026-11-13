import type { CSSProperties } from "react";
const paths = {
  plant: "M4 21V9l7 4V5l7 4V2h3v19H4Zm4-4h1m3 0h1m3 0h1",
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18",
  cube: "m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10L3 7m9 5 9-5m-9 5v10",
  spark:
    "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3ZM20 2v4m-2-2h4",
  play: "m8 4 12 8-12 8V4Z",
  stop: "M6 6h12v12H6z",
  upload: "M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5",
  plus: "M12 5v14M5 12h14",
  trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  refresh: "M20 8a8 8 0 1 0 0 8M20 3v5h-5",
  chevron: "m8 4 8 8-8 8",
  close: "m6 6 12 12M6 18 18 6",
  warning: "m12 3 10 18H2L12 3Zm0 5v6m0 3v1",
  check: "m5 12 4 4L19 6",
  link: "m9 15 6-6M7 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2-2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
} as const;
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
