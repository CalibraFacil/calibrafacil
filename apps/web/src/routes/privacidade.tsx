import { createFileRoute } from '@tanstack/react-router'

import { LegalPageLayout } from '@/components/legal-page-layout'
import { LEGAL_ENTITY } from '@/lib/legal'

export const Route = createFileRoute('/privacidade')({
  component: PrivacyPolicyPage,
  head: () => ({
    meta: [
      {
        title: 'Política de Privacidade | CalibraFácil',
      },
      {
        name: 'description',
        content:
          'Como esta instância do Calibra Fácil trata dados pessoais, nos termos da LGPD.',
      },
    ],
  }),
})

function PrivacyPolicyPage() {
  return (
    <LegalPageLayout
      pathLabel="/privacidade"
      subtitle="Como esta instância do Calibra Fácil trata dados pessoais, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018)."
      title="Política de Privacidade"
    >
      <div className="max-w-none text-foreground [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0 [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:my-2 [&_ol]:my-4 [&_ol]:pl-6 [&_p]:text-[15px] [&_p]:leading-8 [&_p]:text-foreground [&_p+ol]:mt-4 [&_p+ul]:mt-4 [&_p+p]:mt-4 [&_section]:border-t [&_section]:border-border/60 [&_section]:pt-8 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:my-4 [&_ul]:pl-6">
        <section>
          <h2>1. Controlador</h2>
          <p>
            O controlador dos dados pessoais tratados nesta instância é{' '}
            <strong>{LEGAL_ENTITY.legalName}</strong> (CNPJ {LEGAL_ENTITY.cnpj}
            ), que a opera. O encarregado pelo tratamento de dados pessoais é{' '}
            {LEGAL_ENTITY.dpoName}, que pode ser contatado em{' '}
            {LEGAL_ENTITY.dpoEmail}.
          </p>
          <p>
            O Calibra Fácil é software de código aberto. Os seus autores e
            contribuidores não operam esta instância e não têm acesso aos dados
            nela armazenados.
          </p>
        </section>

        <section>
          <h2>2. Dados tratados</h2>
          <ul>
            <li>
              <strong>Dados de conta:</strong> nome, e-mail, organização e papel
              de cada usuário, usados para autenticação e controle de acesso.
            </li>
            <li>
              <strong>Dados técnicos do laboratório:</strong> clientes,
              instrumentos, padrões, calibrações, certificados e demais
              registros exigidos pela ABNT NBR ISO/IEC 17025:2017, que podem
              conter dados de contato de pessoas vinculadas aos clientes.
            </li>
            <li>
              <strong>Registros de acesso e auditoria:</strong> data, hora,
              endereço IP e ações realizadas, mantidos para segurança e para a
              trilha de auditoria exigida pela norma.
            </li>
          </ul>
        </section>

        <section>
          <h2>3. Finalidades e bases legais</h2>
          <p>
            Os dados são tratados para prestar o serviço contratado com o
            operador (execução de contrato), cumprir obrigações legais e
            regulatórias (incluindo a guarda de registros técnicos) e garantir a
            segurança do sistema (legítimo interesse).
          </p>
        </section>

        <section>
          <h2>4. Compartilhamento</h2>
          <p>
            O software não envia dados a terceiros por conta própria. O operador
            pode configurar serviços externos (por exemplo, hospedagem, banco de
            dados, armazenamento de arquivos, envio de e-mails e monitoramento
            de erros), que atuam como operadores de dados em seu nome.
            Informações sobre esses serviços podem ser solicitadas ao
            encarregado.
          </p>
        </section>

        <section>
          <h2>5. Retenção</h2>
          <p>
            Os registros técnicos são mantidos pelo prazo exigido pela norma,
            pelo organismo de acreditação e pela legislação aplicável. Os demais
            dados são mantidos enquanto a conta estiver ativa ou enquanto
            necessários às finalidades acima.
          </p>
        </section>

        <section>
          <h2>6. Direitos do titular</h2>
          <p>
            O titular pode solicitar confirmação de tratamento, acesso,
            correção, anonimização, portabilidade ou eliminação dos seus dados,
            bem como informações sobre compartilhamento, pelo e-mail{' '}
            {LEGAL_ENTITY.dpoEmail}. Registros técnicos sujeitos a obrigação de
            guarda podem não ser elimináveis antes do fim do prazo legal.
          </p>
        </section>
      </div>
    </LegalPageLayout>
  )
}
