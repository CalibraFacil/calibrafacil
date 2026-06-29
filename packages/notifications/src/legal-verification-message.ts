/**
 * Pure pt-BR copy builder for the legal-metrology VERIFICATION reminder
 * (Track 2 — Inmetro / RBMLQ-I). Kept in its OWN module (no DB / wall-clock /
 * email imports) so it is directly unit-testable.
 *
 * Track 2 is INDEPENDENT of the customer-owned calibration interval. The
 * verification periodicity is FIXED BY REGULATION — neither the lab nor the
 * customer sets it. When the regulated period is `operationalizedByDelegate`
 * (the Ipem runs the cronograma), the derived date is INDICATIVE, not a hard
 * national deadline, and the copy must say so (REQ-LVRECALL-006).
 */
export function buildLegalVerificationMessage(params: {
  assetIdentifier: string;
  dueDate: string;
  daysRemaining: number;
  operationalizedByDelegate: boolean;
  regulationReference: string | null;
}): string {
  const { assetIdentifier, dueDate, daysRemaining, regulationReference } =
    params;
  const reference = regulationReference
    ? ` Regulamento: ${regulationReference}.`
    : "";

  if (params.operationalizedByDelegate) {
    // Indicative cadence — the Ipem agenda a verificação; a data NÃO é um prazo
    // nacional fixo. Do not present it as a hard deadline.
    return (
      `O instrumento ${assetIdentifier} está sob regime de metrologia legal e ` +
      `tem verificação metrológica prevista para cerca de ${dueDate} ` +
      `(aproximadamente ${daysRemaining} dias). A cadência é operacionalizada ` +
      `pelo Ipem — a data é indicativa, não é um prazo nacional fixo. ` +
      `Acompanhe o cronograma do órgão delegado.${reference}`
    );
  }

  // Regulation-fixed deadline (Inmetro / RBMLQ-I).
  return (
    `O instrumento ${assetIdentifier} está sob regime de metrologia legal e ` +
    `tem verificação metrológica vencendo em ${daysRemaining} dias (${dueDate}). ` +
    `A periodicidade é fixada por regulamento (Inmetro/RBMLQ-I), não é definida ` +
    `pelo laboratório nem pelo cliente.${reference}`
  );
}
