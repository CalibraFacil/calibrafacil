import { createFileRoute } from '@tanstack/react-router'

import { LegalPageLayout } from '@/components/legal-page-layout'
import {
  LEGAL_ENTITY,
  LEGAL_LAST_UPDATED,
  LEGAL_SUBPROCESSORS,
} from '@/lib/legal'

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
          'Termos e condições gerais de uso da plataforma CalibraFácil para laboratórios de calibração.',
      },
    ],
  }),
})

function TermsOfUsePage() {
  return (
    <LegalPageLayout
      pathLabel="/termos-de-uso"
      subtitle="Termos e condições gerais para contratação e uso da plataforma CalibraFácil, com foco em operação SaaS, LGPD e conformidade técnica para laboratórios."
      title="Termos de Uso"
    >
      <div className="prose prose-slate max-w-none dark:prose-invert prose-headings:scroll-mt-24">
        <section>
          <h2>Preâmbulo</h2>
          <p>
            O presente instrumento estabelece os Termos e Condições Gerais de
            Uso da plataforma <strong>CalibraFácil</strong>, doravante
            denominada simplesmente &quot;PLATAFORMA&quot;, e regula a relação
            jurídica entre as partes abaixo qualificadas.
          </p>
        </section>

        <section>
          <h2>1. Das Definições</h2>
          <p>
            <strong>1.1. LICENCIANTE:</strong> {LEGAL_ENTITY.legalName}, pessoa
            jurídica de direito privado, inscrita no CNPJ sob o nº{' '}
            {LEGAL_ENTITY.cnpj}, com sede em {LEGAL_ENTITY.fullAddress}, titular
            dos direitos de propriedade intelectual sobre a PLATAFORMA
            CalibraFácil.
          </p>
          <p>
            <strong>1.2. LICENCIADO:</strong> pessoa jurídica que contrata os
            serviços da PLATAFORMA, devidamente identificada no momento do
            cadastro, representada por seu responsável legal ou técnico.
          </p>
          <p>
            <strong>1.3. PLATAFORMA:</strong> sistema de gestão disponibilizado
            em nuvem, acessível via internet, destinado à automação de processos
            de calibração, gestão de ativos e emissão de documentos relacionados
            ao serviço.
          </p>
          <p>
            <strong>1.4. CONSTRUTOR DE MÉTODOS:</strong> funcionalidade que
            permite ao LICENCIADO criar, configurar e personalizar fórmulas e
            metodologias de cálculo para procedimentos de calibração.
          </p>
          <p>
            <strong>1.5. CERTIFICADO DE CALIBRAÇÃO:</strong> documento técnico
            gerado pela PLATAFORMA a partir dos dados e fórmulas inseridos pelo
            LICENCIADO.
          </p>
          <p>
            <strong>1.6. DADOS DO LICENCIADO:</strong> conjunto de informações
            inseridas pelo LICENCIADO na PLATAFORMA, incluindo dados de
            clientes, ativos, registros de calibração, certificados e demais
            documentos técnicos.
          </p>
        </section>

        <section>
          <h2>2. Do Objeto</h2>
          <p>
            <strong>2.1.</strong> O presente instrumento tem por objeto a
            concessão, pela LICENCIANTE ao LICENCIADO, de licença de uso não
            exclusiva, intransferível e revogável para acesso e utilização da
            PLATAFORMA CalibraFácil, mediante pagamento de assinatura
            recorrente.
          </p>
          <p>
            <strong>2.2.</strong> A presente licença não implica, em hipótese
            alguma, venda, cessão ou transferência de código-fonte, algoritmos,
            arquitetura de software ou qualquer direito de propriedade
            intelectual sobre a PLATAFORMA.
          </p>
          <p>
            <strong>2.3.</strong> O acesso à PLATAFORMA será disponibilizado
            exclusivamente via internet, em ambiente de computação em nuvem.
          </p>
          <p>
            <strong>2.4.</strong> A LICENCIANTE reserva-se o direito de
            atualizar, modificar ou aprimorar a PLATAFORMA a qualquer tempo,
            visando melhorias técnicas, operacionais ou regulatórias.
          </p>
        </section>

        <section>
          <h2>3. Das Condições de Acesso e Cadastro</h2>
          <p>
            <strong>3.1.</strong> Para utilização da PLATAFORMA, o LICENCIADO
            deverá realizar cadastro e fornecer informações verdadeiras,
            completas e atualizadas, incluindo razão social, CNPJ, dados do
            responsável técnico, informações de contato e dados para
            faturamento.
          </p>
          <p>
            <strong>3.2.</strong> O LICENCIADO é integralmente responsável pela
            veracidade das informações cadastrais, bem como por sua atualização
            tempestiva.
          </p>
          <p>
            <strong>3.3.</strong> As credenciais de acesso são pessoais e
            intransferíveis. O LICENCIADO compromete-se a mantê-las em sigilo e
            a não compartilhá-las com terceiros não autorizados.
          </p>
          <p>
            <strong>3.4.</strong> A LICENCIANTE não se responsabiliza por
            acessos não autorizados decorrentes de negligência do LICENCIADO na
            guarda de suas credenciais.
          </p>
        </section>

        <section>
          <h2>4. Das Condições Financeiras e Pagamento</h2>
          <h3>4.1. Da Assinatura Recorrente</h3>
          <p>
            <strong>4.1.1.</strong> A utilização da PLATAFORMA está condicionada
            ao pagamento de assinatura recorrente, conforme plano contratado
            pelo LICENCIADO.
          </p>
          <p>
            <strong>4.1.2.</strong> Os pagamentos poderão ser processados por
            meio da plataforma Asaas, inclusive nas modalidades boleto bancário
            ou Pix, conforme disponibilidade operacional e escolha do
            LICENCIADO.
          </p>
          <p>
            <strong>4.1.3.</strong> O LICENCIADO reconhece que a gestão de
            pagamentos, emissão de cobranças e processamento transacional do
            gateway contratado são de responsabilidade do respectivo provedor,
            nos limites do serviço prestado.
          </p>

          <h3>4.2. Da Taxa de Implantação</h3>
          <p>
            <strong>4.2.1.</strong> A contratação da PLATAFORMA poderá incluir
            Taxa de Implantação, destinada a cobrir custos de configuração
            inicial, migração de dados, parametrização e treinamento.
          </p>
          <p>
            <strong>4.2.2.</strong> A Taxa de Implantação, quando aplicável,
            será cobrada uma única vez e não será reembolsável após o início do
            processo de onboarding.
          </p>

          <h3>4.3. Da Inadimplência</h3>
          <p>
            <strong>4.3.1.</strong> O não pagamento da assinatura na data de
            vencimento poderá implicar notificação, suspensão temporária do
            acesso e, em caso de persistência do inadimplemento, cancelamento da
            licença, sem prejuízo da cobrança dos valores devidos.
          </p>
          <p>
            <strong>4.3.2.</strong> Durante o período de suspensão, os Dados do
            LICENCIADO poderão ser mantidos íntegros pelo prazo operacional
            definido na Política de Privacidade e em obrigações legais
            aplicáveis.
          </p>

          <h3>4.4. Do Reajuste</h3>
          <p>
            <strong>4.4.1.</strong> Os valores da assinatura poderão ser
            reajustados anualmente, a cada período de 12 meses contados da data
            de contratação, com base na variação acumulada do IPCA, ou índice
            oficial que venha a substituí-lo.
          </p>
          <p>
            <strong>4.4.2.</strong> A LICENCIANTE comunicará eventual reajuste
            ao LICENCIADO com antecedência mínima de 30 dias.
          </p>
        </section>

        <section>
          <h2>5. Das Responsabilidades do LICENCIADO</h2>
          <p>
            <strong>5.1.</strong> Constituem obrigações do LICENCIADO:
          </p>
          <ol>
            <li>
              utilizar a PLATAFORMA em conformidade com a legislação vigente,
              normas técnicas aplicáveis e estes Termos de Uso;
            </li>
            <li>manter atualizados seus dados cadastrais e de faturamento;</li>
            <li>zelar pela segurança de suas credenciais de acesso;</li>
            <li>
              dispor de infraestrutura tecnológica adequada para acesso à
              PLATAFORMA;
            </li>
            <li>
              realizar backup periódico de seus dados críticos, utilizando as
              funcionalidades de exportação disponibilizadas;
            </li>
            <li>
              testar e validar integralmente as fórmulas e metodologias
              inseridas no Construtor de Métodos antes de sua utilização em
              ambiente produtivo;
            </li>
            <li>
              garantir que a utilização da PLATAFORMA esteja em conformidade com
              os requisitos de seu sistema de gestão da qualidade e exigências
              de acreditação aplicáveis.
            </li>
          </ol>
        </section>

        <section className="rounded-3xl border border-amber-500/30 bg-amber-500/8 px-6 py-5">
          <h2>6. Da Limitação de Responsabilidade</h2>
          <h3>6.1. Da Natureza da Ferramenta</h3>
          <p>
            <strong>6.1.1.</strong> O LICENCIADO reconhece expressamente que o
            CalibraFácil é uma ferramenta de meio, destinada a auxiliar e
            automatizar processos laboratoriais, não se tratando de ferramenta
            de resultado.
          </p>
          <p>
            <strong>6.1.2.</strong> A responsabilidade final pela exatidão,
            veracidade, adequação técnica e conformidade normativa dos
            certificados emitidos é exclusiva do responsável técnico do
            LICENCIADO.
          </p>

          <h3>6.2. Da Validação de Métodos e Fórmulas</h3>
          <p>
            <strong>6.2.1.</strong> Em conformidade com a ABNT NBR ISO/IEC
            17025:2017, especialmente os requisitos dos itens 7.2 e 7.11, cabe
            exclusivamente ao LICENCIADO:
          </p>
          <ol>
            <li>
              testar e validar todas as fórmulas, expressões matemáticas e
              metodologias de cálculo inseridas no Construtor de Métodos antes
              de sua utilização em ambiente produtivo;
            </li>
            <li>documentar os procedimentos de validação realizados;</li>
            <li>
              garantir a adequação dos métodos às especificidades de cada tipo
              de calibração;
            </li>
            <li>
              manter evidências objetivas da validação para fins de auditoria e
              acreditação.
            </li>
          </ol>

          <h3>6.3. Da Exclusão de Responsabilidade</h3>
          <p>
            <strong>6.3.1.</strong> A LICENCIANTE não se responsabiliza por:
          </p>
          <ol>
            <li>
              perda, suspensão ou cancelamento de acreditação decorrente de uso
              inadequado da PLATAFORMA ou falta de validação dos métodos pelo
              LICENCIADO;
            </li>
            <li>
              prejuízos financeiros, lucros cessantes, danos morais ou perdas
              comerciais sofridas pelo LICENCIADO ou por terceiros em razão de
              fórmulas configuradas incorretamente, validação insuficiente, uso
              indevido da PLATAFORMA ou interpretação equivocada de resultados;
            </li>
            <li>
              decisões técnicas tomadas pelo LICENCIADO com base nos resultados
              gerados pela PLATAFORMA.
            </li>
          </ol>
          <p>
            <strong>6.3.2.</strong> Em qualquer hipótese, a responsabilidade
            máxima da LICENCIANTE, se cabível, ficará limitada ao valor
            equivalente aos últimos 3 meses de assinatura efetivamente pagos
            pelo LICENCIADO.
          </p>
        </section>

        <section>
          <h2>7. Da Propriedade Intelectual</h2>
          <p>
            <strong>7.1.</strong> São de propriedade exclusiva da LICENCIANTE,
            protegidos pela legislação brasileira de propriedade intelectual, o
            código-fonte da PLATAFORMA, sua arquitetura, algoritmos, layout,
            design, identidade visual, documentação técnica e marcas
            relacionadas.
          </p>
          <p>
            <strong>7.2.</strong> São de propriedade exclusiva do LICENCIADO os
            Dados do LICENCIADO inseridos na PLATAFORMA, incluindo dados
            cadastrais de seus clientes, informações de ativos e instrumentos,
            registros e resultados de calibração, certificados gerados,
            fórmulas, métodos personalizados e anexos carregados.
          </p>
        </section>

        <section>
          <h2>8. Da Proteção de Dados Pessoais</h2>
          <p>
            <strong>8.1.</strong> As partes comprometem-se a cumprir
            integralmente a Lei nº 13.709/2018 (LGPD) e demais normas aplicáveis
            à proteção de dados pessoais.
          </p>
          <p>
            <strong>8.2.</strong> Para fins de LGPD, as partes reconhecem que o
            LICENCIADO atua como controlador dos dados pessoais de seus clientes
            e colaboradores inseridos na PLATAFORMA, enquanto a LICENCIANTE atua
            como operadora, realizando o tratamento de dados em nome e por conta
            do LICENCIADO nos limites da prestação do serviço contratado.
          </p>
          <p>
            <strong>8.3.</strong> A LICENCIANTE poderá subcontratar serviços de
            infraestrutura e apoio operacional, desde que os suboperadores
            ofereçam garantias adequadas de proteção de dados. Atualmente, os
            provedores utilizados incluem:
          </p>
          <ul>
            {LEGAL_SUBPROCESSORS.map((processor) => (
              <li key={processor.name}>
                <strong>{processor.name}</strong>: {processor.role}.
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>9. Do Direito à Portabilidade e Exportação de Dados</h2>
          <p>
            <strong>9.1.</strong> Ao término da relação contratual, por qualquer
            motivo, o LICENCIADO terá o direito de exportar seus dados
            armazenados na PLATAFORMA.
          </p>
          <p>
            <strong>9.2.</strong> A exportação poderá ser realizada por meio das
            funcionalidades disponíveis na PLATAFORMA, inclusive em formatos
            como JSON, CSV e PDF, quando aplicável ao tipo de dado.
          </p>
          <p>
            <strong>9.3.</strong> O LICENCIADO terá o prazo de 30 dias corridos,
            contados da data de encerramento do contrato, para realizar a
            exportação de seus dados.
          </p>
          <p>
            <strong>9.4.</strong> Decorrido esse prazo, a LICENCIANTE poderá
            proceder à exclusão definitiva dos Dados do LICENCIADO, ressalvadas
            hipóteses legais ou regulatórias de retenção.
          </p>
        </section>

        <section>
          <h2>10. Do Nível de Serviço</h2>
          <p>
            <strong>10.1.</strong> A LICENCIANTE envidará esforços
            comercialmente razoáveis para manter a PLATAFORMA disponível com
            índice mensal alvo de 99,5%, desconsiderados períodos de manutenção
            programada, indisponibilidades decorrentes de caso fortuito ou força
            maior e falhas de infraestrutura de terceiros fora de seu controle.
          </p>
          <p>
            <strong>10.2.</strong> O suporte técnico será prestado por canal
            eletrônico e pelo e-mail {LEGAL_ENTITY.email}, em dias úteis, das 9h
            às 18h, horário de Brasília, com atendimento inicial priorizado
            conforme criticidade reportada.
          </p>
          <p>
            <strong>10.3.</strong> Os prazos de atendimento referem-se à
            primeira resposta e não constituem compromisso de resolução
            definitiva dentro do mesmo período.
          </p>
        </section>

        <section>
          <h2>11. Da Vigência e Rescisão</h2>
          <p>
            <strong>11.1.</strong> O presente instrumento entra em vigor na data
            do aceite eletrônico pelo LICENCIADO e permanecerá vigente por prazo
            indeterminado enquanto mantida a assinatura ativa.
          </p>
          <p>
            <strong>11.2.</strong> Qualquer das partes poderá rescindir o
            presente instrumento a qualquer tempo, mediante comunicação por
            escrito à outra parte com antecedência mínima de 30 dias.
          </p>
          <p>
            <strong>11.3.</strong> Constituem motivos para rescisão imediata,
            independentemente de notificação prévia, a inadimplência persistente
            do LICENCIADO, violação de cláusulas essenciais, uso da PLATAFORMA
            para fins ilícitos, tentativa de acesso não autorizado ou
            dissolução/falência de qualquer das partes.
          </p>
        </section>

        <section>
          <h2>12. Das Disposições Gerais</h2>
          <p>
            <strong>12.1.</strong> Todas as comunicações entre as partes poderão
            ser realizadas por meio eletrônico, para os endereços de e-mail
            cadastrados.
          </p>
          <p>
            <strong>12.2.</strong> A LICENCIANTE poderá alterar os presentes
            Termos de Uso a qualquer tempo, comunicando o LICENCIADO com
            antecedência mínima de 30 dias.
          </p>
          <p>
            <strong>12.3.</strong> O LICENCIADO não poderá ceder ou transferir
            seus direitos e obrigações decorrentes deste instrumento a
            terceiros, sem prévia autorização escrita da LICENCIANTE.
          </p>
          <p>
            <strong>12.4.</strong> Se qualquer cláusula deste instrumento for
            considerada nula ou inexequível, as demais permanecerão em pleno
            vigor e efeito.
          </p>
        </section>

        <section>
          <h2>13. Do Foro</h2>
          <p>
            <strong>13.1.</strong> As partes elegem o foro da Comarca de{' '}
            {LEGAL_ENTITY.forum}, com exclusão de qualquer outro, por mais
            privilegiado que seja, para dirimir quaisquer controvérsias oriundas
            deste instrumento.
          </p>
        </section>

        <section>
          <h2>14. Do Aceite Eletrônico</h2>
          <p>
            <strong>14.1.</strong> O LICENCIADO declara ter lido, compreendido e
            aceito integralmente os presentes Termos de Uso por meio de aceite
            eletrônico, no momento do cadastro ou contratação da PLATAFORMA.
          </p>
          <p>
            <strong>14.2.</strong> O aceite eletrônico tem validade jurídica
            equivalente à assinatura física, nos termos do art. 10, §2º, da
            Medida Provisória nº 2.200-2/2001.
          </p>
        </section>

        <section className="not-prose mt-10 rounded-3xl border border-border/70 bg-muted/30 p-6">
          <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
            <div>
              <p className="font-medium text-foreground">
                Dados da licenciante
              </p>
              <p>{LEGAL_ENTITY.legalName}</p>
              <p>CNPJ: {LEGAL_ENTITY.cnpj}</p>
            </div>
            <div className="md:text-right">
              <p>Atualizado em {LEGAL_LAST_UPDATED}</p>
              <p>{LEGAL_ENTITY.fullAddress}</p>
              <p>{LEGAL_ENTITY.email}</p>
            </div>
          </div>
        </section>
      </div>
    </LegalPageLayout>
  )
}
