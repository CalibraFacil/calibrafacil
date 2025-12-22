import { HeadContent, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: App,
  head: () => ({
    meta: [
      {
        title: 'CalibraFácil | Gestão de Calibrações',
      },
    ],
  }),
})

function App() {
  return (
    <>
      <HeadContent />
    </>
  )
}
