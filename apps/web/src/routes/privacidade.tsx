import { createFileRoute } from '@tanstack/react-router'

import { LegalPageLayout } from '@/components/legal-page-layout'
import {
  LEGAL_ENTITY,
  LEGAL_LAST_UPDATED,
  LEGAL_SUBPROCESSORS,
  LEGAL_TECHNICAL_RETENTION_YEARS,
} from '@/lib/legal'

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
          'Política de Privacidade da CalibraFácil em conformidade com a LGPD para usuários e clientes da plataforma.',
      },
    ],
  }),
})

function PrivacyPolicyPage() {
  return (
    <LegalPageLayout
      pathLabel="/privacidade"
      subtitle="Como a CalibraFácil coleta, utiliza, compartilha e protege dados pessoais em conformidade com a Lei Geral de Proteção de Dados."
      title="Política de Privacidade"
    >
      <div className="max-w-none text-foreground [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0 [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:my-2 [&_ol]:my-4 [&_ol]:pl-6 [&_p]:text-[15px] [&_p]:leading-8 [&_p]:text-foreground [&_p+ol]:mt-4 [&_p+ul]:mt-4 [&_p+p]:mt-4 [&_section]:border-t [&_section]:border-border/60 [&_section]:pt-8 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:my-4 [&_ul]:pl-6">
        <section>
          <h2>Introdução</h2>
          <p>
            A <strong>{LEGAL_ENTITY.legalName}</strong>{' '}
            (&quot;CalibraFácil&quot;, &quot;nós&quot; ou &quot;nossa&quot;),
            inscrita no CNPJ sob o nº {LEGAL_ENTITY.cnpj}, com sede em{' '}
            {LEGAL_ENTITY.fullAddress}, está comprometida com a proteção da
            privacidade e dos dados pessoais de seus usuários.
          </p>
          <p>
            Esta Política de Privacidade descreve como coletamos, utilizamos,
            armazenamos, compartilhamos e protegemos seus dados pessoais, em
            conformidade com a Lei nº 13.709/2018 (Lei Geral de Proteção de
            Dados Pessoais, ou LGPD) e demais normas aplicáveis.
          </p>
          <p>
            Ao utilizar a plataforma CalibraFácil, você declara estar ciente e
            de acordo com os termos desta Política de Privacidade.
          </p>
        </section>

        <section className="rounded-2xl border border-border/60 bg-muted/25 px-6 py-5">
          <h2>1. Dos Agentes de Tratamento de Dados</h2>
          <h3>1.1. CalibraFácil como Controlador</h3>
          <p>
            O CalibraFácil atua como <strong>CONTROLADOR</strong> dos dados
            pessoais relacionados ao cadastro, autenticação, relacionamento
            comercial, faturamento, suporte e uso da plataforma pelos
            administradores e colaboradores dos laboratórios clientes.
          </p>
          <ul>
            <li>dados cadastrais, como nome, e-mail, telefone e CPF;</li>
            <li>dados profissionais, como cargo e registros técnicos;</li>
            <li>dados de acesso, autenticação e navegação;</li>
            <li>dados de faturamento e cobrança.</li>
          </ul>

          <h3>1.2. CalibraFácil como Operador</h3>
          <p>
            O CalibraFácil atua como <strong>OPERADOR</strong> em relação aos
            dados de negócio inseridos pelos laboratórios clientes na
            plataforma, incluindo dados cadastrais de clientes, informações de
            ativos, registros de calibração, certificados e documentos técnicos.
          </p>
          <p>
            Nessa hipótese, o laboratório cliente é o{' '}
            <strong>CONTROLADOR</strong> desses dados e define finalidades,
            bases legais e instruções de tratamento.
          </p>
        </section>

        <section>
          <h2>2. Dos Dados Pessoais Coletados</h2>
          <h3>2.1. Dados de Cadastro</h3>
          <ul>
            <li>dados de identificação, como nome completo e CPF;</li>
            <li>dados de contato, como e-mail e telefone;</li>
            <li>
              dados profissionais, como função e registro profissional quando
              aplicável;
            </li>
            <li>
              dados da empresa contratante, como razão social, CNPJ e endereço
              comercial.
            </li>
          </ul>

          <h3>2.2. Dados de Uso e Navegação</h3>
          <ul>
            <li>dados de acesso, como endereço IP, data e hora do acesso;</li>
            <li>
              dados do dispositivo, como sistema operacional, navegador e tipo
              de equipamento;
            </li>
            <li>
              logs de auditoria relacionados a ações realizadas na plataforma.
            </li>
          </ul>
          <p>
            Esses dados são coletados para fins de segurança, auditoria,
            integridade operacional e conformidade com requisitos da ABNT NBR
            ISO/IEC 17025:2017.
          </p>

          <h3>2.3. Dados Financeiros</h3>
          <p>
            Os dados financeiros necessários para processamento de pagamentos
            são tratados por integração com a plataforma Asaas. O CalibraFácil
            não armazena dados completos de cartão de crédito ou outras
            informações bancárias sensíveis processadas diretamente pelo gateway
            contratado.
          </p>
        </section>

        <section>
          <h2>3. Das Finalidades do Tratamento</h2>
          <div className="not-prose overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-border/70 bg-background/40 text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="border-b border-border/70 px-4 py-3 text-left font-semibold text-foreground">
                    Finalidade
                  </th>
                  <th className="border-b border-border/70 px-4 py-3 text-left font-semibold text-foreground">
                    Base legal
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    'Prestação do serviço SaaS contratado',
                    'Execução de contrato (art. 7º, V)',
                  ],
                  [
                    'Autenticação e controle de acesso',
                    'Execução de contrato (art. 7º, V)',
                  ],
                  [
                    'Auditoria e trilha de integridade',
                    'Legítimo interesse e obrigação regulatória',
                  ],
                  [
                    'Faturamento e cobrança',
                    'Execução de contrato e obrigação legal',
                  ],
                  [
                    'Suporte e comunicações operacionais',
                    'Execução de contrato',
                  ],
                  [
                    'Prevenção de fraudes e segurança',
                    'Legítimo interesse (art. 7º, IX)',
                  ],
                ].map(([purpose, basis]) => (
                  <tr key={purpose}>
                    <td className="border-b border-border/50 px-4 py-3 align-top text-foreground">
                      {purpose}
                    </td>
                    <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                      {basis}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            O CalibraFácil não comercializa dados pessoais a terceiros nem os
            utiliza para publicidade comportamental de terceiros.
          </p>
        </section>

        <section>
          <h2>4. Do Compartilhamento de Dados</h2>
          <p>
            Para a prestação do serviço, compartilhamos dados com provedores de
            infraestrutura e serviços de apoio, estritamente nos limites
            necessários à operação da plataforma:
          </p>
          <div className="not-prose overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-border/70 bg-background/40 text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="border-b border-border/70 px-4 py-3 text-left font-semibold text-foreground">
                    Provedor
                  </th>
                  <th className="border-b border-border/70 px-4 py-3 text-left font-semibold text-foreground">
                    Função
                  </th>
                  <th className="border-b border-border/70 px-4 py-3 text-left font-semibold text-foreground">
                    Dados compartilhados
                  </th>
                </tr>
              </thead>
              <tbody>
                {LEGAL_SUBPROCESSORS.map((processor) => (
                  <tr key={processor.name}>
                    <td className="border-b border-border/50 px-4 py-3 align-top font-semibold text-foreground">
                      {processor.name}
                    </td>
                    <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                      {processor.role}
                    </td>
                    <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                      {processor.sharedData}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Também poderemos compartilhar dados pessoais por determinação legal
            ou judicial, para proteção de direitos da plataforma, de seus
            usuários ou de terceiros, e em contextos de reorganização societária
            compatíveis com a legislação aplicável.
          </p>
        </section>

        <section>
          <h2>5. Da Segurança dos Dados</h2>
          <p>
            O CalibraFácil adota medidas técnicas e organizacionais adequadas
            para proteger os dados pessoais contra acessos não autorizados,
            destruição, perda, alteração ou qualquer forma de tratamento
            inadequado.
          </p>
          <ul>
            <li>uso de HTTPS/TLS nas comunicações;</li>
            <li>
              controles de autenticação, credenciais e permissões compatíveis
              com o perfil de acesso e o contexto organizacional;
            </li>
            <li>
              isolamento lógico entre organizações em arquitetura multi-tenant;
            </li>
            <li>
              registros de auditoria imutáveis para rastreabilidade de eventos
              técnicos e operacionais relevantes;
            </li>
            <li>
              rotinas de backup, monitoramento operacional e procedimentos de
              resposta a incidentes;
            </li>
            <li>
              uso de provedores de infraestrutura que oferecem salvaguardas de
              segurança compatíveis com serviços em nuvem de uso corporativo.
            </li>
          </ul>
          <p>
            Em conformidade com os requisitos de integridade e rastreabilidade
            exigidos pela ABNT NBR ISO/IEC 17025:2017, a plataforma mantém logs
            de auditoria imutáveis sobre alterações relevantes em registros
            técnicos e operacionais.
          </p>
          <p>
            Sempre que suportado pela arquitetura e pelos provedores
            contratados, as salvaguardas incluem proteção de dados em repouso,
            segregação de ambiente e controles de acesso administrativos
            proporcionais ao risco do tratamento.
          </p>
        </section>

        <section>
          <h2>6. Da Retenção de Dados</h2>
          <p>
            Os dados pessoais são mantidos pelo tempo necessário ao cumprimento
            das finalidades descritas nesta política, observando critérios
            contratuais, legais e regulatórios.
          </p>
          <div className="not-prose overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-border/70 bg-background/40 text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="border-b border-border/70 px-4 py-3 text-left font-semibold text-foreground">
                    Tipo de dado
                  </th>
                  <th className="border-b border-border/70 px-4 py-3 text-left font-semibold text-foreground">
                    Período de retenção
                  </th>
                  <th className="border-b border-border/70 px-4 py-3 text-left font-semibold text-foreground">
                    Justificativa
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    'Dados cadastrais',
                    'Enquanto o contrato estiver ativo + 30 dias',
                    'Execução do contrato e janela de exportação',
                  ],
                  [
                    'Dados de faturamento',
                    '5 anos após o encerramento',
                    'Obrigações fiscais e defesa de direitos',
                  ],
                  [
                    'Logs de auditoria técnica',
                    `${LEGAL_TECHNICAL_RETENTION_YEARS} anos`,
                    'Conformidade ISO 17025 e rastreabilidade operacional',
                  ],
                  [
                    'Registros de calibração armazenados pelo cliente',
                    `${LEGAL_TECHNICAL_RETENTION_YEARS} anos ou prazo superior definido pelo controlador`,
                    'Retenção técnica e política do laboratório cliente',
                  ],
                  [
                    'Logs de acesso de segurança',
                    '6 meses',
                    'Investigação de incidentes e proteção da plataforma',
                  ],
                ].map(([dataType, retention, reason]) => (
                  <tr key={dataType}>
                    <td className="border-b border-border/50 px-4 py-3 align-top text-foreground">
                      {dataType}
                    </td>
                    <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                      {retention}
                    </td>
                    <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                      {reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>7. Dos Cookies e Tecnologias Similares</h2>
          <p>
            A plataforma CalibraFácil utiliza cookies técnicos e estritamente
            necessários para autenticação, manutenção de sessão e preferências
            essenciais de navegação.
          </p>
          <p>
            A base legal aplicável a esses cookies é a execução do contrato e,
            quando cabível, o legítimo interesse relacionado à segurança,
            estabilidade e continuidade do serviço.
          </p>
          <div className="not-prose overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-border/70 bg-background/40 text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="border-b border-border/70 px-4 py-3 text-left font-semibold text-foreground">
                    Tipo
                  </th>
                  <th className="border-b border-border/70 px-4 py-3 text-left font-semibold text-foreground">
                    Finalidade
                  </th>
                  <th className="border-b border-border/70 px-4 py-3 text-left font-semibold text-foreground">
                    Duração
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    'Cookies de sessão',
                    'Autenticação e navegação segura durante a sessão ativa',
                    'Expiram ao encerrar a sessão do navegador',
                  ],
                  [
                    'Cookies persistentes de preferência',
                    'Manutenção de preferências essenciais, como tema e contexto de navegação',
                    'Até 12 meses, conforme a funcionalidade utilizada',
                  ],
                ].map(([kind, purpose, duration]) => (
                  <tr key={kind}>
                    <td className="border-b border-border/50 px-4 py-3 align-top font-semibold text-foreground">
                      {kind}
                    </td>
                    <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                      {purpose}
                    </td>
                    <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                      {duration}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            O CalibraFácil não utiliza, nesta política, cookies de rastreamento
            publicitário de terceiros nem comercializa dados de navegação.
          </p>
        </section>

        <section className="rounded-2xl border border-border/60 bg-muted/25 px-6 py-5">
          <h2>8. Dos Direitos dos Titulares de Dados</h2>
          <p>
            Em conformidade com a LGPD, você pode solicitar confirmação do
            tratamento, acesso, correção, anonimização, bloqueio, eliminação,
            portabilidade, informações sobre compartilhamento, revogação de
            consentimento e oposição ao tratamento, quando cabível.
          </p>
          <p>Para exercer seus direitos, entre em contato com:</p>
          <div className="not-prose rounded-2xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">Encarregado:</strong>{' '}
              {LEGAL_ENTITY.dpoName}
            </p>
            <p>
              <strong className="text-foreground">E-mail:</strong>{' '}
              {LEGAL_ENTITY.dpoEmail}
            </p>
            <p>
              <strong className="text-foreground">Endereço:</strong>{' '}
              {LEGAL_ENTITY.fullAddress}
            </p>
          </div>
          <p>
            As solicitações serão respondidas em prazo compatível com a LGPD e
            com a complexidade do pedido, podendo exigir confirmação prévia de
            identidade.
          </p>
        </section>

        <section>
          <h2>9. Da Transferência Internacional de Dados</h2>
          <p>
            Alguns provedores utilizados pela plataforma podem processar dados
            fora do Brasil. Nessas hipóteses, a transferência internacional
            ocorrerá conforme os mecanismos previstos no art. 33 da LGPD,
            incluindo cláusulas contratuais e garantias adequadas.
          </p>
          <p>
            Quando aplicável, a CalibraFácil utiliza instrumentos contratuais
            com operadores e suboperadores contendo cláusulas padrão de proteção
            de dados, obrigações equivalentes de confidencialidade, segurança e
            tratamento limitado à finalidade contratada, além de medidas
            suplementares compatíveis com o risco envolvido.
          </p>
          <p>
            Entre as medidas suplementares que podem ser empregadas conforme o
            caso estão controles de acesso, segregação lógica, minimização de
            dados, trilhas de auditoria e revisão periódica da necessidade de
            manutenção do fornecedor internacional no fluxo operacional.
          </p>
        </section>

        <section>
          <h2>10. Dos Incidentes de Segurança</h2>
          <p>
            Em caso de incidente de segurança que possa acarretar risco ou dano
            relevante aos titulares, o CalibraFácil adotará as medidas cabíveis
            de resposta, mitigação e comunicação, inclusive à ANPD e aos
            titulares afetados, quando exigido.
          </p>
          <p>
            Quando atuando como operadora, o CalibraFácil comunicará o
            laboratório cliente controlador sem atraso injustificado e em prazo
            compatível com a gravidade do evento, fornecendo as informações
            disponíveis para avaliação, contenção e eventual comunicação aos
            titulares e autoridades competentes.
          </p>
        </section>

        <section>
          <h2>11. Das Alterações desta Política</h2>
          <p>
            Esta Política de Privacidade poderá ser atualizada periodicamente
            para refletir mudanças em práticas operacionais, legais ou
            regulatórias. A versão vigente permanecerá disponível nesta página e
            indica a última data de atualização: {LEGAL_LAST_UPDATED}.
          </p>
        </section>

        <section>
          <h2>12. Do Contato</h2>
          <p>
            Para dúvidas, solicitações ou reclamações relacionadas a esta
            Política de Privacidade ou ao tratamento de seus dados pessoais,
            entre em contato com:
          </p>
          <div className="not-prose rounded-2xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">
              {LEGAL_ENTITY.legalName}
            </p>
            <p>CNPJ: {LEGAL_ENTITY.cnpj}</p>
            <p>{LEGAL_ENTITY.fullAddress}</p>
            <p>E-mail geral: {LEGAL_ENTITY.email}</p>
            <p>E-mail do encarregado: {LEGAL_ENTITY.dpoEmail}</p>
          </div>
        </section>

        <section>
          <h2>13. Do Foro</h2>
          <p>
            Esta Política de Privacidade é regida pelas leis da República
            Federativa do Brasil. Fica eleito o foro da Comarca de{' '}
            {LEGAL_ENTITY.forum}, com exclusão de qualquer outro, por mais
            privilegiado que seja, para dirimir quaisquer controvérsias dela
            decorrentes.
          </p>
        </section>
      </div>
    </LegalPageLayout>
  )
}
