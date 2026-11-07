/**
 * The per-status component names the API's outbox drain still imports, as
 * one-line wrappers over `ServiceOrderStatusEmail`. Next step: the drain
 * renders `ServiceOrderStatusEmail` / `serviceOrderStatusEmailSubject` by
 * status and these go away.
 */
import {
  ServiceOrderStatusEmail,
  type ServiceOrderEmailStatus,
  type ServiceOrderStatusEmailProps,
} from "./service-order-status-email";

type StatusEmailProps = Omit<ServiceOrderStatusEmailProps, "status">;

const forStatus =
  (status: ServiceOrderEmailStatus) => (props: StatusEmailProps) =>
    ServiceOrderStatusEmail({ ...props, status });

export const ServiceStartedEmail = forStatus("repair_in_progress");
export const AwaitingEvaluationEmail = forStatus("awaiting_tech_evaluation");
export const UnderEvaluationEmail = forStatus("under_evaluation");
export const ReadyForPickupEmail = forStatus("ready_for_pickup");
export const ServiceOrderDeliveredEmail = forStatus("delivered");
export const ServiceOrderClosedEmail = forStatus("closed");
export const FinalReviewEmail = forStatus("awaiting_final_review");
export const ServiceOrderCanceledEmail = forStatus("canceled");
export const WarrantyReturnEmail = forStatus("warranty_return");

export type ServiceInProgressStage =
  | "awaiting_calibration"
  | "calibration_in_progress";

export function ServiceInProgressEmail({
  stage,
  ...props
}: StatusEmailProps & { stage: ServiceInProgressStage }) {
  return ServiceOrderStatusEmail({ ...props, status: stage });
}
