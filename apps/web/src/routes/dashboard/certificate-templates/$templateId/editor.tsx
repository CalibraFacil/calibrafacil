import { createFileRoute } from '@tanstack/react-router'

import { CertificateTemplateEditorPage } from '@/features/certificate-templates/editor/editor-page'
import { loadCertificateTemplateEditorData } from '@/features/certificate-templates/editor/queries'

export const Route = createFileRoute(
  '/dashboard/certificate-templates/$templateId/editor',
)({
  head: () => ({
    meta: [{ title: 'Editor de Certificado | CalibraFácil' }],
  }),
  loader: ({ context, params }) =>
    loadCertificateTemplateEditorData(context.queryClient, params.templateId),
  component: CertificateTemplateEditorRoute,
})

function CertificateTemplateEditorRoute() {
  const { templateId } = Route.useParams()

  return <CertificateTemplateEditorPage templateId={templateId} />
}
