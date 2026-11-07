import { createFileRoute, redirect } from '@tanstack/react-router'

// The lab app has no landing page of its own (the project site is apps/site),
// so "/" always bounces into the product; the dashboard guard sends users
// without a session on to /sign-in, on the desktop as in the cloud.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' })
  },
})
