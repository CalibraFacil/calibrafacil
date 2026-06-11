import { AccreditationSealSvg } from "@calibra-facil/documents";

import "./accreditation-seal.css";

/**
 * RBC/CGCRE accreditation seal as shown on accredited certificates. At rest
 * it is pixel-identical to the seal printed on the issued PDF; hovering adds
 * a web-only specular sweep.
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
