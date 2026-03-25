# @calibra-facil/shared

Shared configuration, plan definitions, and utility types.

## Overview

This package provides centralized configuration for subscription plans, feature flags, and shared utilities used across the platform.

## Installation

```bash
pnpm add @calibra-facil/shared
```

## Usage

```typescript
import {
  getPlan,
  hasFeature,
  hasEntitlement,
  getLimit,
  isSubscriptionActive,
} from "@calibra-facil/shared";

// Get plan details
const plan = getPlan("PROFESSIONAL");

// Check entitlement access
if (hasEntitlement(userPlan, "approval_workflow")) {
  // Enable review flow
}

// Legacy helper still works
if (hasFeature(userPlan, "portal")) {
  // Enable portal feature
}

// Get resource limits
const maxCertificates = getLimit(userPlan, "certificates");

// Check subscription status
if (isSubscriptionActive(subscription.status)) {
  // Allow access
}
```

## Plans

| Plan         | Certificates/mo | Users | Storage | Features                                                                                             |
| ------------ | --------------- | ----- | ------- | ---------------------------------------------------------------------------------------------------- |
| FREE         | 10              | 1     | 100MB   | -                                                                                                    |
| STANDARD     | 100             | 5     | 5GB     | math_engine, portal                                                                                  |
| PROFESSIONAL | 800             | 999   | 50GB    | +financial, +api, +custom_domain, +approval_workflow                                                 |
| ENTERPRISE   | Unlimited       | 999   | 1TB     | +advanced_audit_trail, +custom_templates, +priority_support, +sso, +multi_unit, +custom_integrations |

## Feature Flags

| Feature                | Description                         | Available     |
| ---------------------- | ----------------------------------- | ------------- |
| `math_engine`          | GUM uncertainty calculations        | Standard+     |
| `portal`               | Client portal access                | Standard+     |
| `financial`            | Invoicing and payments              | Professional+ |
| `api`                  | API access                          | Professional+ |
| `custom_domain`        | Custom domain support               | Professional+ |
| `sso`                  | Corporate SSO for the lab dashboard | Enterprise    |
| `approval_workflow`    | Review and approval flows           | Professional+ |
| `advanced_audit_trail` | Detailed compliance history         | Professional+ |
| `custom_templates`     | Custom certificate templates        | Professional+ |
| `priority_support`     | Priority operational support        | Professional+ |
| `multi_unit`           | Multi-unit operations               | Enterprise    |
| `custom_integrations`  | Tailored integrations               | Enterprise    |

## Helper Functions

- `getPlan(planId)` - Get full plan configuration
- `hasEntitlement(planId, feature)` - Check if plan has entitlement
- `hasFeature(planId, feature)` - Check if plan has feature
- `getLimit(planId, resource)` - Get resource limit for plan
- `getEnabledEntitlements(planId)` - List enabled plan entitlements
- `isValidPlanId(id)` - Type guard for plan IDs
- `isSubscriptionActive(status)` - Check if subscription is active/trial
- `getPlanPrice(planId, cycle)` - Get pricing for plan
- `formatPrice(cents)` - Format BRL price

## Exports

- `@calibra-facil/shared` - Re-exports from plans
- `@calibra-facil/shared/plans` - Plan definitions
