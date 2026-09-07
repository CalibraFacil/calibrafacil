import type { SVGProps } from "react";

/*
 * Custom line icons for the coverage grid, drawn for the lab's vocabulary
 * (a calibration weight, a control chart, a label with a barcode) instead of
 * generic UI glyphs. 24px grid, 1.5px stroke, round caps and joins, currentColor.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** Calibration weight with its knob. */
export function WeightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
      <path d="M7.8 6.5h8.4l2.3 12.2a1.5 1.5 0 0 1-1.47 1.8H6.97a1.5 1.5 0 0 1-1.47-1.8L7.8 6.5Z" />
      <path d="M9.5 15.5h5" />
    </Svg>
  );
}

/** Calendar with a recall arrow. */
export function RecallIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5V11" />
      <path d="M4 8.5V17.5A2.5 2.5 0 0 0 6.5 20H11" />
      <path d="M8 4v4M16 4v4M4 11h9" />
      <path d="M20.5 15.5a3.5 3.5 0 1 1-1.02-2.48" />
      <path d="M20.5 12.5v2.5H18" />
    </Svg>
  );
}

/** Work order: clipboard with a wrench. */
export function WorkOrderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.2 5.2a3.6 3.6 0 0 0-4.6 4.6L4.5 14.9a1.6 1.6 0 0 0 2.3 2.3l5.1-5.1a3.6 3.6 0 0 0 4.6-4.6l-2.1 2.1-2-.5-.5-2 2.3-1.9Z" />
      <path d="m13.5 14.5 4.2 4.2a1.6 1.6 0 0 0 2.3-2.3L15.8 12.2" />
      <path d="M7.2 7.2 5 5 6 4l2.2 2.2" />
    </Svg>
  );
}

/** Non-conformance with a corrective loop. */
export function CapaIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M17.5 3.5v3.5H14" />
      <path d="M12 8.5v4.5M12 16.2v.01" />
    </Svg>
  );
}

/** Proficiency test: two flasks compared. */
export function ProficiencyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 4h4M7 4v5.4l-3.1 6.6A1.4 1.4 0 0 0 5.17 18H8.8a1.4 1.4 0 0 0 1.27-2L7 9.4" />
      <path d="M15 4h4M17 4v5.4l-3.1 6.6a1.4 1.4 0 0 0 1.27 2h3.63a1.4 1.4 0 0 0 1.27-2L17 9.4" />
      <path d="M4.7 14.5h4.4M14.7 14.5h4.4" />
      <path d="M10.5 11h3M10.5 13h3" />
    </Svg>
  );
}

/** Control chart: readings between two limits. */
export function ControlChartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4v16h16" />
      <path d="M7 7.5h13M7 16.5h13" strokeDasharray="2 2" />
      <path d="M7 12l2.5-2 2.5 3 2.5-4 2.5 3 2.5-1.5" />
      <circle cx="9.5" cy="10" r="0.6" fill="currentColor" />
      <circle cx="14.5" cy="9" r="0.6" fill="currentColor" />
      <circle cx="19.5" cy="10.5" r="0.6" fill="currentColor" />
    </Svg>
  );
}

/** Person with a competence badge. */
export function CompetenceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 11.2-4.5" />
      <path d="m17.5 13.5 1.1 2.1 2.4.4-1.75 1.7.4 2.4-2.15-1.15-2.15 1.15.4-2.4-1.75-1.7 2.4-.4 1.1-2.1Z" />
    </Svg>
  );
}

/** Method: document with graduated marks. */
export function MethodIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3.5h7l4 4v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="M14 3.5v4h4" />
      <path d="M8.5 12h7M8.5 12v2M10.25 12v1.2M12 12v2M13.75 12v1.2M15.5 12v2" />
      <path d="M8.5 17.5h4" />
    </Svg>
  );
}

/** Finance: receipt with lines. */
export function FinanceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5v-17Z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </Svg>
  );
}

/** Label with a barcode. */
export function LabelIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5.5h11.2a1.5 1.5 0 0 1 1.1.48L20.5 12l-4.2 6.02a1.5 1.5 0 0 1-1.1.48H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z" />
      <path d="M6.5 9v6M9 9v6M11.5 9v6M13.5 9v6" />
    </Svg>
  );
}

/** Units and groups: two buildings. */
export function UnitsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 20.5h17" />
      <path d="M5 20.5V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v14.5" />
      <path d="M13 20.5v-9.5h5a1 1 0 0 1 1 1v8.5" />
      <path d="M7.5 8.5h2M7.5 11.5h2M7.5 14.5h2M15.5 14h1M15.5 17h1" />
    </Svg>
  );
}

/** Offline: cloud with a slash and the sync that follows. */
export function OfflineIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 18.5a4.5 4.5 0 0 1-1.2-8.84A5.5 5.5 0 0 1 16.6 8.2" />
      <path d="M18.4 11.3A3.6 3.6 0 0 1 17.5 18.5H11" />
      <path d="M4 4l16 16" />
    </Svg>
  );
}
