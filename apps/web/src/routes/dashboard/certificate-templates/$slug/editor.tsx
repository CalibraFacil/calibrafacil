import { createFileRoute } from '@tanstack/react-router'

import { CertificateTemplateEditorPage } from '@/features/certificate-templates/editor/editor-page'
import { loadCertificateTemplateEditorData } from '@/features/certificate-templates/editor/queries'

export const Route = createFileRoute(
  '/dashboard/certificate-templates/$slug/editor',
)({
  head: () => ({
    meta: [{ title: 'Editor de Certificado | CalibraFácil' }],
  }),
  loader: ({ context, params }) =>
    loadCertificateTemplateEditorData(context.queryClient, params.slug),
  component: CertificateTemplateEditorRoute,
})

function CertificateTemplateEditorRoute() {
  const { slug } = Route.useParams()

  return <CertificateTemplateEditorPage slug={slug} />
}
