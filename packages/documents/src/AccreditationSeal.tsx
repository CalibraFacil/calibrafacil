/** @jsxImportSource react */
import { useId } from "react";
import {
  ACCREDITATION_SEAL_SUBTITLE,
  ACCREDITATION_SEAL_TITLE,
  formatAccreditationNumber,
} from "@calibra-facil/shared/accreditation";

/**
 * Canonical RBC/CGCRE-style accreditation seal (artwork based on the official
 * Inmetro mark). At rest it renders pixel-for-pixel the same everywhere — the
 * issued PDF, the settings panel and the portal. Hover/holographic treatments
 * are a presentation-layer concern: consumers opt into extra SVG layers via
 * `effect` and animate them with their own CSS (classes `seal-sheen`,
 * `seal-foil`, `seal-glare`). The default ("none") is the regulated artwork.
 */

export type AccreditationSealEffect = "none" | "sheen" | "holo";

export type AccreditationSealProps = {
  /** Digits-only accreditation number; rendered as "CAL 0123". */
  accreditationNumber: string | null | undefined;
  effect?: AccreditationSealEffect;
  className?: string;
  width?: number | string;
};

const SEAL_FONT_FAMILY = "Carlito, Calibri, Inter, Arial, sans-serif";

export const ACCREDITATION_SEAL_VIEWBOX = "0 0 130 196";

export function AccreditationSealSvg({
  accreditationNumber,
  effect = "none",
  className,
  width = 130,
}: AccreditationSealProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientId = `seal-grad-${uid}`;
  const clipId = `seal-clip-${uid}`;
  const foilId = `seal-foil-${uid}`;
  const sheenId = `seal-sheen-${uid}`;
  const glareId = `seal-glare-${uid}`;
  const formattedNumber = formatAccreditationNumber(accreditationNumber);

  return (
    <svg
      className={className}
      viewBox={ACCREDITATION_SEAL_VIEWBOX}
      width={width}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={
        formattedNumber
          ? `Selo de acreditação ${ACCREDITATION_SEAL_SUBTITLE} ${formattedNumber}`
          : `Selo de acreditação ${ACCREDITATION_SEAL_SUBTITLE}`
      }
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="9.2"
          y1="105"
          x2="121.8"
          y2="105"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#004E8C" />
          <stop offset="1" stopColor="#006D9A" />
        </linearGradient>
        <clipPath id={clipId}>
          <path d="M110.502 3H18.4167C13.064 3 9 7.05941 9 12.4059V43H122V12.4059C122 7.05941 118.035 3 110.502 3Z" />
          <rect x="9.2" y="48.4" width="112.6" height="114" />
          <rect x="9.2" y="168.3" width="112.6" height="25.6" />
        </clipPath>
        {effect === "holo" ? (
          <linearGradient id={foilId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff46c8" stopOpacity="0" />
            <stop offset="0.18" stopColor="#ff46c8" stopOpacity="0.38" />
            <stop offset="0.34" stopColor="#ffd34f" stopOpacity="0.32" />
            <stop offset="0.5" stopColor="#46ffc8" stopOpacity="0.38" />
            <stop offset="0.66" stopColor="#46a0ff" stopOpacity="0.38" />
            <stop offset="0.82" stopColor="#b44fff" stopOpacity="0.32" />
            <stop offset="1" stopColor="#b44fff" stopOpacity="0" />
          </linearGradient>
        ) : null}
        {effect === "sheen" ? (
          <linearGradient id={sheenId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        ) : null}
        {effect === "holo" ? (
          <radialGradient id={glareId}>
            <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        ) : null}
      </defs>
      <path
        d="M110.502 3H18.4167C13.064 3 9 7.05941 9 12.4059V43H122V12.4059C122 7.05941 118.035 3 110.502 3Z"
        fill="#00B4EC"
      />
      <text
        x="65.5"
        y="22.5"
        textAnchor="middle"
        fontFamily={SEAL_FONT_FAMILY}
        fontSize="11"
        fontWeight="700"
        letterSpacing="0.6"
        fill="#000000"
      >
        {ACCREDITATION_SEAL_TITLE}
      </text>
      <text
        x="65.5"
        y="35"
        textAnchor="middle"
        fontFamily={SEAL_FONT_FAMILY}
        fontSize="9"
        fontWeight="600"
        fill="#000000"
      >
        {ACCREDITATION_SEAL_SUBTITLE}
      </text>
      <path d="M9.2 48.4V162.4H121.8V48.4H9.2Z" fill={`url(#${gradientId})`} />
      <g className="seal-glyph">
        <path
          d="M121.8 48.4L112.8 48.5C99.2 48.6 70 53.1 65.7 81.6H87.1C87.5 68 97.9 62.6 121.7 63H121.8V48.4ZM77.5 126.7C77.5 114.1 85.6 105.8 121.8 106.1V91.7C89.6 90.4 57.9 96.8 57.9 125.4C57.9 147.8 73.2 162.2 101.6 162.3C108.1 162.4 115.7 161.9 121.8 159.9V145.9C99 150.4 77.5 147.8 77.5 126.7Z"
          fill="#00BAF2"
        />
      </g>
      <path
        transform="translate(16.12 125.85) scale(0.011375)"
        fill="#FFFFFF"
        fillRule="evenodd"
        d="m1626.9 1889.4h516.4v241h-1791.6v-243.5h516.9v-729.2zm-1275.2-1524.8h1791.6v218.8h-516.4v723.5l-759.5-724h-515.7z"
      />
      <path d="M9.2 168.3V193.9H121.8V168.3H9.2Z" fill="#00BAF2" />
      {formattedNumber ? (
        <text
          x="65.5"
          y="185.5"
          textAnchor="middle"
          fontFamily={SEAL_FONT_FAMILY}
          fontSize="13"
          fontWeight="700"
          letterSpacing="1"
          fill="#000000"
        >
          {formattedNumber}
        </text>
      ) : null}
      {effect === "holo" ? (
        <g clipPath={`url(#${clipId})`}>
          <rect
            className="seal-foil"
            x="-150"
            y="-60"
            width="430"
            height="320"
            fill={`url(#${foilId})`}
          />
        </g>
      ) : null}
      {effect === "holo" ? (
        <g clipPath={`url(#${clipId})`}>
          <g className="seal-glare">
            <circle cx="65" cy="98" r="78" fill={`url(#${glareId})`} />
          </g>
        </g>
      ) : null}
      {effect === "sheen" ? (
        <g clipPath={`url(#${clipId})`}>
          <rect
            className="seal-sheen"
            x="-70"
            y="-30"
            width="48"
            height="260"
            fill={`url(#${sheenId})`}
            transform="rotate(18 65 98)"
          />
        </g>
      ) : null}
    </svg>
  );
}
