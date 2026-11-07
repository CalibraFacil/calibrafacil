import {
  CERTIFICATE_LIFECYCLE_STATUS,
  type CertificateLifecycleStatus,
} from "@calibra-facil/schemas";

import { StatusPill } from "@/components/status-pill";

/** A certificate's lifecycle (valid, superseded, withdrawn) as the portal's pill. */
export function CertificateLifecyclePill({
  status,
  ...props
}: { status: CertificateLifecycleStatus } & Omit<
  React.ComponentProps<typeof StatusPill>,
  "tone" | "children"
>) {
  return (
    <StatusPill tone={CERTIFICATE_LIFECYCLE_STATUS.tone(status)} {...props}>
      {CERTIFICATE_LIFECYCLE_STATUS.label(status)}
    </StatusPill>
  );
}
