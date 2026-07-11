import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/proficiency-tests')({
  component: ProficiencyTestsLayout,
})

function ProficiencyTestsLayout() {
  return <Outlet />
}
