import { createFileRoute } from '@tanstack/react-router'

import { LegalPageLayout } from '@/components/legal-page-layout'
import { LEGAL_ENTITY, PROJECT_REPOSITORY_URL } from '@/lib/legal'

export const Route = createFileRoute('/termos-de-uso')({
  component: TermsOfUsePage,
  head: () => ({
    meta: [
      {
        title: 'Termos de Uso | CalibraFácil',
      },
      {
        name: 'description',
        content:
          'Termos de uso desta instância do Calibra Fácil, software de código aberto para laboratórios de calibração.',
      },
    ],
  }),
})

function TermsOfUsePage() {
  return (
    <LegalPageLayout
      pathLabel="/termos-de-uso"
      subtitle="Condições de uso desta instância do Calibra Fácil, software de código aberto distribuído sob a licença MIT."
      title="Termos de Uso"
    >
      <div className="max-w-none text-foreground [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0 [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:my-2 [&_ol]:my-4 [&_ol]:pl-6 [&_p]:text-[15px] [&_p]:leading-8 [&_p]:text-foreground [&_p+ol]:mt-4 [&_p+ul]:mt-4 [&_p+p]:mt-4 [&_section]:border-t [&_section]:border-border/60 [&_section]:pt-8 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:my-4 [&_ul]:pl-6">
        <section>
          <h2>1. O software</h2>
          <p>
            O Calibra Fácil é um software de código aberto para a gestão de
            laboratórios de calibração, distribuído sob a{' '}
            <a href={`${PROJECT_REPOSITORY_URL}/blob/main/LICENSE`}>
              licença MIT
            </a>
            . O código-fonte é público e pode ser utilizado, modificado e
            redistribuído nos termos dessa licença.
          </p>
          <p>
            O software é fornecido <strong>no estado em que se encontra</strong>
            , sem garantia de qualquer tipo, expressa ou implícita. Os autores e
            contribuidores do projeto não respondem por danos ou prejuízos
            decorrentes do seu uso.
          </p>
        </section>

        <section>
          <h2>2. Quem opera esta instância</h2>
          <p>
            Esta instância é operada por{' '}
            <strong>{LEGAL_ENTITY.legalName}</strong>, responsável pela sua
            disponibilidade, pelas contas de acesso e pelas condições comerciais
            eventualmente aplicáveis. Dúvidas e solicitações devem ser enviadas
            para {LEGAL_ENTITY.email}.
          </p>
          <p>
            O projeto de código aberto não presta serviço nesta instância e não
            tem acesso aos dados nela armazenados.
          </p>
        </section>

        <section>
          <h2>3. Responsabilidade técnica do laboratório</h2>
          <p>
            Os cálculos, registros e certificados produzidos com o sistema são
            de responsabilidade exclusiva do laboratório que os emite. Cabe a
            cada laboratório:
          </p>
          <ul>
            <li>
              validar o software e os seus métodos de calibração no próprio
              contexto, conforme a ABNT NBR ISO/IEC 17025:2017 (em especial as
              cláusulas 7.2.2 e 7.11);
            </li>
            <li>
              revisar os resultados antes de aprová-los e emitir certificados;
            </li>
            <li>
              manter os registros técnicos pelo prazo exigido pela norma, pelo
              organismo de acreditação e pela legislação aplicável.
            </li>
          </ul>
          <p>
            Os dossiês de validação publicados com o código-fonte são
            referências técnicas: não são aprovações e não substituem a
            validação do laboratório.
          </p>
        </section>

        <section>
          <h2>4. Uso aceitável</h2>
          <p>
            O usuário compromete-se a utilizar a instância de forma lícita, a
            manter as suas credenciais de acesso em sigilo e a não tentar
            acessar dados de outros laboratórios ou contornar os controles de
            acesso do sistema.
          </p>
        </section>

        <section>
          <h2>5. Dados pessoais</h2>
          <p>
            O tratamento de dados pessoais nesta instância é descrito na{' '}
            <a href="/privacidade">Política de Privacidade</a>.
          </p>
        </section>
      </div>
    </LegalPageLayout>
  )
}
