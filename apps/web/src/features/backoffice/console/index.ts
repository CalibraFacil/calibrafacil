/**
 * Backoffice console design system — barrel.
 *
 * Usage:
 *   import { ConsolePageHeader, StatusChip, status } from '@/features/backoffice/console'
 *   <StatusChip status={status.healthStatus(org.healthStatus)} />
 */
export * from './components'
export type { StatusDescriptor } from './status'
export * as status from './status'
