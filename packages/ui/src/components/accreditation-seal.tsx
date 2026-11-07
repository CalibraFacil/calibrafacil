import { AccreditationSealSvg } from "@calibra-facil/documents";

/**
 * RBC/CGCRE accreditation seal as shown on accredited certificates, in the lab
 * app and the client portal. At rest it is pixel-identical to the seal printed
 * on the issued PDF (`AccreditationSealSvg` in `@calibra-facil/documents` is the
 * one artwork); hovering adds a web-only specular sweep, styled by
 * `styles/accreditation-seal.css`, which `tokens.css` imports (the tilt there
 * matches the `rotate(18 ...)` of the sheen layer the SVG draws).
 */
export function AccreditationSeal({
  accreditationNumber,
  width = 92,
}: {
  accreditationNumber: string | null | undefined;
  width?: number;
}) {
  return (
    <div className="accreditation-seal">
      <AccreditationSealSvg
        accreditationNumber={accreditationNumber}
        effect="sheen"
        width={width}
      />
    </div>
  );
}
