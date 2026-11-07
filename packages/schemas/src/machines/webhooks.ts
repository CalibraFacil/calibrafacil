// Public API webhooks as data.
import {
  PUBLIC_API_WEBHOOK_DELIVERY_STATUSES,
  PUBLIC_API_WEBHOOK_SUBSCRIPTION_STATUSES,
} from "@calibra-facil/shared";
import { defineStateMachine } from "../state-machine";

// public_api_webhook_subscription.status
//   create        routes/public-api-v2/webhooks.ts POST (ACTIVE or INACTIVE)
//   set_status    the same route's PATCH (switched on or off by the integrator)
//   auto_disable  the delivery worker (packages/jobs-core webhook-delivery.ts),
//                   after PUBLIC_API_WEBHOOK_AUTO_DISABLE_AFTER exhausted deliveries
export const WEBHOOK_SUBSCRIPTION_MACHINE = defineStateMachine({
  name: "webhook subscription",
  states: PUBLIC_API_WEBHOOK_SUBSCRIPTION_STATUSES,
  commands: ["create", "set_status", "auto_disable"],
  transitions: [
    { from: null, command: "create", to: "ACTIVE" },
    { from: null, command: "create", to: "INACTIVE" },
    { from: "ACTIVE", command: "set_status", to: "INACTIVE" },
    { from: "INACTIVE", command: "set_status", to: "ACTIVE" },
    { from: "ACTIVE", command: "auto_disable", to: "INACTIVE" },
  ],
});

// public_api_webhook_delivery.status: one event to one subscriber.
//   create   apps/api/src/domains/public-api/public-api-webhooks.ts (an event, or a replay)
//   retry    the worker: a failed attempt with attempts left (stays PENDING)
//   succeed  the subscriber answered 2xx
//   fail     attempts exhausted, or the subscription was switched off
export const WEBHOOK_DELIVERY_MACHINE = defineStateMachine({
  name: "webhook delivery",
  states: PUBLIC_API_WEBHOOK_DELIVERY_STATUSES,
  commands: ["create", "retry", "succeed", "fail"],
  transitions: [
    { from: null, command: "create", to: "PENDING" },
    { from: "PENDING", command: "retry", to: "PENDING" },
    { from: "PENDING", command: "succeed", to: "SUCCESS" },
    { from: "PENDING", command: "fail", to: "FAILED" },
  ],
});
