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
import { getPlan, hasFeature, getLimit, isSubscriptionActive } from "@calibra-facil/shared";

// Get plan details
const plan = getPlan("PROFESSIONAL");

// Check feature access
if (hasFeature(userPlan, "portal")) {
  // Enable portal feature
}

// Get resource limits
const maxCertificates = getLimit(userPlan, "certificatesPerMonth");

// Check subscription status
if (isSubscriptionActive(subscription.status)) {
  // Allow access
}
```

## Plans

| Plan | Certificates/mo | Users | Storage | Features |
|------|-----------------|-------|---------|----------|
| FREE | 10 | 1 | 100MB | - |
| STANDARD | 200 | 5 | 5GB | math_engine |
| PROFESSIONAL | 1000 | 999 | 50GB | +portal, +financial |
| ENTERPRISE | Unlimited | 999 | 1TB | +api, +custom_domain |

## Feature Flags

| Feature | Description | Available |
|---------|-------------|-----------|
| `math_engine` | GUM uncertainty calculations | Standard+ |
| `portal` | Client portal access | Professional+ |
| `financial` | Invoicing and payments | Professional+ |
| `api` | API access | Enterprise |
| `custom_domain` | Custom domain support | Enterprise |

## Helper Functions

- `getPlan(planId)` - Get full plan configuration
- `hasFeature(planId, feature)` - Check if plan has feature
- `getLimit(planId, resource)` - Get resource limit for plan
- `isValidPlanId(id)` - Type guard for plan IDs
- `isSubscriptionActive(status)` - Check if subscription is active/trial
- `getPlanPrice(planId, cycle)` - Get pricing for plan
- `formatPrice(cents)` - Format BRL price

## Exports

- `@calibra-facil/shared` - Re-exports from plans
- `@calibra-facil/shared/plans` - Plan definitions
