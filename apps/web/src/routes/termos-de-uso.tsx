import { HeadContent, createFileRoute, Link } from '@tanstack/react-router'
import { HugeiconsIcon } from "@hugeicons/react"
import { Shield01Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons"

export const Route = createFileRoute('/termos-de-uso')({
  component: TermosDeUso,
  head: () => ({
    meta: [
      {
        title: 'Termos de Uso | CalibraFácil',
        description: 'Termos e Condições Gerais de Uso da plataforma CalibraFácil - Sistema de Gestão para Laboratórios de Calibração.',
      },
    ],
  }),
})

function TermosDeUso() {
  return (
    <>
      <HeadContent />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        {/* Header */}
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <Link to="/" className="flex items-center gap-2">
                <div className="bg-sky-600 text-white p-1 rounded-lg">
                  <HugeiconsIcon icon={Shield01Icon} size={20} strokeWidth={2.5} />
                </div>
                <span className="text-lg font-bold text-slate-900 dark:text-white">
                  Calibra<span className="text-sky-600">Fácil</span>
                </span>
              </Link>
              <Link
                to="/"
                className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
                Voltar ao início
              </Link>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <article className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-8 sm:p-12">
            {/* Title */}
            <div className="text-center mb-12 pb-8 border-b border-slate-200 dark:border-slate-800">
              <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white mb-4">
                Termos de Uso
              </h1>
              <p className="text-slate-500 dark:text-slate-400">
                Plataforma CalibraFácil
              </p>
              <div className="mt-4 flex items-center justify-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                <span>Versão: 1.0</span>
                <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                <span>Última atualização: [DATA]</span>
              </div>
            </div>

            {/* Legal Content */}
            <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-20">

              {/* Preâmbulo */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4 uppercase tracking-wide">
                  Preâmbulo
                </h2>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  O presente instrumento estabelece os Termos e Condições Gerais de Uso da plataforma <strong>CalibraFácil</strong>, doravante denominada simplesmente "PLATAFORMA", e regula a relação jurídica entre as partes abaixo qualificadas.
                </p>
              </section>

              {/* Cláusula 1 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  1. Das Definições
                </h2>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
                  Para os fins deste instrumento, consideram-se as seguintes definições:
                </p>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>1.1. LICENCIANTE:</strong> [RAZÃO SOCIAL COMPLETA], pessoa jurídica de direito privado, inscrita no CNPJ sob o nº [XX.XXX.XXX/0001-XX], com sede na [ENDEREÇO COMPLETO, CIDADE/UF, CEP], titular dos direitos de propriedade intelectual sobre a PLATAFORMA CalibraFácil.
                  </p>
                  <p>
                    <strong>1.2. LICENCIADO:</strong> Pessoa jurídica que contrata os serviços da PLATAFORMA, devidamente identificada no momento do cadastro, representada por seu responsável legal ou técnico.
                  </p>
                  <p>
                    <strong>1.3. PLATAFORMA:</strong> Sistema de Gestão de Informações Laboratoriais (LIMS) disponibilizado em ambiente de computação em nuvem (cloud computing), acessível via internet, destinado à automação de processos de calibração, gestão de ativos e emissão de certificados.
                  </p>
                  <p>
                    <strong>1.4. CONSTRUTOR DE MÉTODOS (Motor de Cálculo):</strong> Funcionalidade da PLATAFORMA que permite ao LICENCIADO criar, configurar e personalizar fórmulas e metodologias de cálculo para procedimentos de calibração.
                  </p>
                  <p>
                    <strong>1.5. CERTIFICADO DE CALIBRAÇÃO:</strong> Documento técnico gerado pela PLATAFORMA a partir dos dados e fórmulas inseridos pelo LICENCIADO.
                  </p>
                  <p>
                    <strong>1.6. DADOS DO LICENCIADO:</strong> Conjunto de informações inseridas pelo LICENCIADO na PLATAFORMA, incluindo, mas não se limitando a: dados de clientes, informações de ativos, registros de calibração, certificados e demais documentos técnicos.
                  </p>
                </div>
              </section>

              {/* Cláusula 2 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  2. Do Objeto
                </h2>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>2.1.</strong> O presente instrumento tem por objeto a concessão, pela LICENCIANTE ao LICENCIADO, de <strong>licença de uso não exclusiva, intransferível e revogável</strong> para acesso e utilização da PLATAFORMA CalibraFácil, mediante pagamento de assinatura recorrente.
                  </p>
                  <p>
                    <strong>2.2.</strong> A presente licença <strong>não implica, em hipótese alguma</strong>, venda, cessão ou transferência de código-fonte, algoritmos, arquitetura de software ou qualquer direito de propriedade intelectual sobre a PLATAFORMA.
                  </p>
                  <p>
                    <strong>2.3.</strong> O acesso à PLATAFORMA será disponibilizado exclusivamente via internet, em ambiente de computação em nuvem, não sendo fornecida ao LICENCIADO qualquer cópia instalável do software.
                  </p>
                  <p>
                    <strong>2.4.</strong> A LICENCIANTE reserva-se o direito de atualizar, modificar ou aprimorar a PLATAFORMA a qualquer tempo, visando melhorias técnicas ou adequações regulatórias, sem que isso constitua alteração do objeto contratual.
                  </p>
                </div>
              </section>

              {/* Cláusula 3 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  3. Das Condições de Acesso e Cadastro
                </h2>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>3.1.</strong> Para utilização da PLATAFORMA, o LICENCIADO deverá realizar cadastro, fornecendo informações verdadeiras, completas e atualizadas, incluindo:
                  </p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li>Razão Social e CNPJ;</li>
                    <li>Dados do Responsável Técnico;</li>
                    <li>Informações de contato (e-mail, telefone);</li>
                    <li>Dados para faturamento.</li>
                  </ul>
                  <p>
                    <strong>3.2.</strong> O LICENCIADO é integralmente responsável pela veracidade das informações cadastrais, bem como por sua atualização tempestiva.
                  </p>
                  <p>
                    <strong>3.3.</strong> As credenciais de acesso (login e senha) são pessoais e intransferíveis. O LICENCIADO compromete-se a mantê-las em sigilo e a não compartilhá-las com terceiros não autorizados.
                  </p>
                  <p>
                    <strong>3.4.</strong> A LICENCIANTE não se responsabiliza por acessos não autorizados decorrentes de negligência do LICENCIADO na guarda de suas credenciais.
                  </p>
                </div>
              </section>

              {/* Cláusula 4 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  4. Das Condições Financeiras e Pagamento
                </h2>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  4.1. Da Assinatura Recorrente
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>4.1.1.</strong> A utilização da PLATAFORMA está condicionada ao pagamento de assinatura mensal recorrente, conforme plano contratado pelo LICENCIADO.
                  </p>
                  <p>
                    <strong>4.1.2.</strong> Os pagamentos serão processados por meio da plataforma de pagamentos <strong>Asaas</strong>, nas modalidades Boleto Bancário ou Pix, conforme escolha do LICENCIADO.
                  </p>
                  <p>
                    <strong>4.1.3.</strong> O LICENCIADO autoriza expressamente a cobrança recorrente por meio da plataforma Asaas, reconhecendo que a gestão de pagamentos, emissão de boletos e processamento de transações são de responsabilidade do referido gateway.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  4.2. Da Taxa de Implantação (Setup Fee)
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>4.2.1.</strong> A contratação da PLATAFORMA poderá incluir Taxa de Implantação (Setup Fee), destinada a cobrir os custos de configuração inicial, migração de dados e treinamento.
                  </p>
                  <p>
                    <strong>4.2.2.</strong> A Taxa de Implantação será cobrada uma única vez, no início da contratação, e <strong>não será objeto de reembolso</strong> após o início do processo de onboarding, independentemente de eventual desistência ou rescisão por parte do LICENCIADO.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  4.3. Da Inadimplência
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>4.3.1.</strong> O não pagamento da assinatura mensal na data de vencimento implicará:
                  </p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li><strong>Após 5 dias de atraso:</strong> Notificação por e-mail;</li>
                    <li><strong>Após 15 dias de atraso:</strong> Suspensão temporária do acesso à PLATAFORMA;</li>
                    <li><strong>Após 30 dias de atraso:</strong> Cancelamento automático da licença, sem prejuízo da cobrança dos valores devidos.</li>
                  </ul>
                  <p>
                    <strong>4.3.2.</strong> Durante o período de suspensão, os Dados do LICENCIADO serão mantidos íntegros, podendo o acesso ser restabelecido mediante quitação integral dos débitos pendentes.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  4.4. Do Reajuste Anual
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>4.4.1.</strong> Os valores da assinatura mensal serão reajustados anualmente, a cada período de 12 (doze) meses contados da data de contratação, com base na variação acumulada do <strong>IPCA (Índice Nacional de Preços ao Consumidor Amplo)</strong>, publicado pelo IBGE.
                  </p>
                  <p>
                    <strong>4.4.2.</strong> Na hipótese de extinção do IPCA, será utilizado o <strong>IGP-M (Índice Geral de Preços do Mercado)</strong>, publicado pela FGV, ou outro índice oficial que venha a substituí-lo.
                  </p>
                  <p>
                    <strong>4.4.3.</strong> A LICENCIANTE comunicará o reajuste ao LICENCIADO com antecedência mínima de 30 (trinta) dias, por meio do e-mail cadastrado.
                  </p>
                </div>
              </section>

              {/* Cláusula 5 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  5. Das Responsabilidades do Licenciado
                </h2>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>5.1.</strong> Constituem obrigações do LICENCIADO:
                  </p>
                  <ol className="list-[lower-alpha] list-inside ml-4 space-y-2">
                    <li>Utilizar a PLATAFORMA em conformidade com a legislação vigente, normas técnicas aplicáveis e os termos deste instrumento;</li>
                    <li>Manter atualizados seus dados cadastrais e de faturamento;</li>
                    <li>Zelar pela segurança de suas credenciais de acesso;</li>
                    <li>Dispor de infraestrutura tecnológica adequada (conexão à internet, navegador atualizado) para acesso à PLATAFORMA;</li>
                    <li>Realizar backup periódico de seus dados críticos, utilizando as funcionalidades de exportação disponibilizadas pela PLATAFORMA;</li>
                    <li><strong>Testar e validar integralmente</strong> as fórmulas e metodologias inseridas no Construtor de Métodos antes de sua utilização em ambiente produtivo;</li>
                    <li>Garantir que a utilização da PLATAFORMA esteja em conformidade com os requisitos de seu Sistema de Gestão da Qualidade e com as exigências de acreditação aplicáveis.</li>
                  </ol>
                </div>
              </section>

              {/* Cláusula 6 - IMPORTANTE */}
              <section className="mb-10 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-6 -mx-2">
                <div className="flex items-center gap-2 mb-4">
                  <span className="bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded uppercase">
                    Cláusula Essencial
                  </span>
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  6. Da Limitação de Responsabilidade
                </h2>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  6.1. Da Natureza da Ferramenta
                </h3>
                <div className="space-y-4 text-slate-700 dark:text-slate-300">
                  <p>
                    <strong>6.1.1.</strong> O LICENCIADO <strong>reconhece expressamente</strong> que o CalibraFácil é uma <strong>ferramenta de meio</strong>, destinada a auxiliar e automatizar processos laboratoriais, <strong>não se tratando de ferramenta de resultado</strong>.
                  </p>
                  <p>
                    <strong>6.1.2.</strong> A responsabilidade final pela <strong>exatidão, veracidade, adequação técnica e conformidade normativa</strong> dos Certificados de Calibração emitidos é <strong>exclusiva do Responsável Técnico do LICENCIADO</strong>, nos termos da legislação profissional aplicável e das normas de acreditação.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  6.2. Da Validação de Métodos e Fórmulas
                </h3>
                <div className="space-y-4 text-slate-700 dark:text-slate-300">
                  <p>
                    <strong>6.2.1.</strong> Em conformidade com a norma <strong>ABNT NBR ISO/IEC 17025:2017</strong>, especialmente os requisitos constantes dos itens <strong>7.2 (Seleção, verificação e validação de métodos)</strong> e <strong>7.11 (Controle de dados e gestão de informação)</strong>, cabe <strong>exclusivamente ao LICENCIADO</strong>:
                  </p>
                  <ol className="list-[lower-alpha] list-inside ml-4 space-y-2">
                    <li>Testar e validar todas as fórmulas, expressões matemáticas e metodologias de cálculo inseridas no <strong>Construtor de Métodos</strong> antes de sua utilização em ambiente produtivo;</li>
                    <li>Documentar os procedimentos de validação realizados;</li>
                    <li>Garantir a adequação dos métodos às especificidades de cada tipo de calibração;</li>
                    <li>Manter evidências objetivas da validação para fins de auditoria e acreditação.</li>
                  </ol>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  6.3. Da Exclusão de Responsabilidade
                </h3>
                <div className="space-y-4 text-slate-700 dark:text-slate-300">
                  <p>
                    <strong>6.3.1.</strong> A LICENCIANTE <strong>não se responsabiliza</strong>, em qualquer hipótese, por:
                  </p>
                  <ol className="list-[lower-alpha] list-inside ml-4 space-y-3">
                    <li><strong>Perda, suspensão ou cancelamento de acreditação</strong> junto à CGCRE/Inmetro ou qualquer outro organismo de acreditação, decorrente de uso inadequado da PLATAFORMA ou falta de validação dos métodos pelo LICENCIADO;</li>
                    <li><strong>Recalls de instrumentos</strong>, recolhimentos de produtos ou quaisquer medidas corretivas determinadas em razão de certificados emitidos com base em fórmulas não validadas ou incorretamente configuradas pelo LICENCIADO;</li>
                    <li>
                      <strong>Prejuízos financeiros diretos ou indiretos</strong>, lucros cessantes, danos morais ou quaisquer perdas comerciais sofridas pelo LICENCIADO ou por terceiros, decorrentes de:
                      <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                        <li>Erros em cálculos resultantes de fórmulas inseridas pelo próprio LICENCIADO;</li>
                        <li>Uso indevido ou não autorizado da PLATAFORMA;</li>
                        <li>Falta de validação adequada dos métodos de calibração;</li>
                        <li>Interpretação equivocada de resultados.</li>
                      </ul>
                    </li>
                    <li><strong>Decisões técnicas</strong> tomadas pelo LICENCIADO com base nos resultados gerados pela PLATAFORMA.</li>
                  </ol>
                  <p className="mt-4">
                    <strong>6.3.2.</strong> Em qualquer hipótese, a responsabilidade máxima da LICENCIANTE, se cabível, ficará limitada ao valor equivalente aos últimos 3 (três) meses de assinatura efetivamente pagos pelo LICENCIADO.
                  </p>
                </div>
              </section>

              {/* Cláusula 7 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  7. Da Propriedade Intelectual
                </h2>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  7.1. Da Propriedade da LICENCIANTE
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>7.1.1.</strong> São de propriedade exclusiva da LICENCIANTE, protegidos pela legislação brasileira de propriedade intelectual (Lei nº 9.609/98 e Lei nº 9.610/98):
                  </p>
                  <ol className="list-[lower-alpha] list-inside ml-4 space-y-1">
                    <li>O código-fonte da PLATAFORMA, em todas as suas versões;</li>
                    <li>A arquitetura, estrutura lógica e algoritmos do sistema;</li>
                    <li>O layout, design, identidade visual e elementos gráficos;</li>
                    <li>Os modelos de documentos e templates fornecidos;</li>
                    <li>A documentação técnica e manuais;</li>
                    <li>As marcas "CalibraFácil" e logotipos associados.</li>
                  </ol>
                  <p>
                    <strong>7.1.2.</strong> A licença concedida ao LICENCIADO não transfere qualquer direito de propriedade intelectual sobre os elementos acima descritos.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  7.2. Da Propriedade do LICENCIADO
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>7.2.1.</strong> São de propriedade exclusiva do LICENCIADO todos os <strong>Dados do LICENCIADO</strong> inseridos na PLATAFORMA, incluindo:
                  </p>
                  <ol className="list-[lower-alpha] list-inside ml-4 space-y-1">
                    <li>Dados cadastrais de seus clientes;</li>
                    <li>Informações de ativos e instrumentos;</li>
                    <li>Registros e resultados de calibração;</li>
                    <li>Certificados de Calibração gerados;</li>
                    <li>Fórmulas e métodos personalizados criados no Construtor de Métodos;</li>
                    <li>Documentos e anexos carregados na PLATAFORMA.</li>
                  </ol>
                  <p>
                    <strong>7.2.2.</strong> A LICENCIANTE não adquire qualquer direito de propriedade sobre os Dados do LICENCIADO pelo simples fato de seu armazenamento na PLATAFORMA.
                  </p>
                </div>
              </section>

              {/* Cláusula 8 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  8. Da Proteção de Dados Pessoais (LGPD)
                </h2>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  8.1. Do Tratamento de Dados
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>8.1.1.</strong> As partes comprometem-se a cumprir integralmente a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais — LGPD) e demais normas aplicáveis à proteção de dados pessoais.
                  </p>
                  <p>
                    <strong>8.1.2.</strong> Para fins de LGPD, as partes reconhecem que:
                  </p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li>O <strong>LICENCIADO</strong> atua como <strong>CONTROLADOR</strong> dos dados pessoais de seus clientes e colaboradores inseridos na PLATAFORMA;</li>
                    <li>A <strong>LICENCIANTE</strong> atua como <strong>OPERADORA</strong>, realizando o tratamento de dados pessoais em nome e por conta do LICENCIADO, nos limites estritamente necessários à prestação dos serviços contratados.</li>
                  </ul>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  8.2. Das Obrigações da LICENCIANTE como Operadora
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>8.2.1.</strong> A LICENCIANTE compromete-se a:
                  </p>
                  <ol className="list-[lower-alpha] list-inside ml-4 space-y-2">
                    <li>Tratar os dados pessoais exclusivamente conforme as instruções lícitas do LICENCIADO;</li>
                    <li>Garantir que seus colaboradores e prepostos estejam sujeitos a obrigação de confidencialidade;</li>
                    <li>Adotar medidas técnicas e organizacionais de segurança adequadas à proteção dos dados;</li>
                    <li>Auxiliar o LICENCIADO no atendimento às solicitações de titulares de dados;</li>
                    <li>Notificar o LICENCIADO, no prazo de 48 (quarenta e oito) horas, em caso de incidente de segurança que possa acarretar risco ou dano relevante aos titulares;</li>
                    <li>Eliminar os dados pessoais ao término da relação contratual, ressalvadas as hipóteses de conservação legalmente autorizadas.</li>
                  </ol>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  8.3. Da Subcontratação
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>8.3.1.</strong> O LICENCIADO autoriza a LICENCIANTE a subcontratar serviços de infraestrutura em nuvem (cloud computing) para hospedagem da PLATAFORMA, desde que os suboperadores ofereçam garantias adequadas de proteção de dados.
                  </p>
                  <p>
                    <strong>8.3.2.</strong> A LICENCIANTE mantém contratos com os seguintes provedores de infraestrutura: [LISTAR PROVEDORES].
                  </p>
                </div>
              </section>

              {/* Cláusula 9 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  9. Do Direito à Portabilidade e Exportação de Dados
                </h2>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>9.1.</strong> Ao término da relação contratual, por qualquer motivo, o LICENCIADO terá o direito de <strong>exportar seus dados</strong> armazenados na PLATAFORMA.
                  </p>
                  <p>
                    <strong>9.2.</strong> A exportação poderá ser realizada pelo próprio LICENCIADO, por meio das funcionalidades disponíveis na PLATAFORMA, nos seguintes formatos:
                  </p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li><strong>JSON</strong> (JavaScript Object Notation);</li>
                    <li><strong>CSV</strong> (Comma-Separated Values);</li>
                    <li><strong>PDF</strong> (para certificados e documentos).</li>
                  </ul>
                  <p>
                    <strong>9.3.</strong> O LICENCIADO terá o prazo de <strong>30 (trinta) dias corridos</strong>, contados da data de encerramento do contrato, para realizar a exportação de seus dados.
                  </p>
                  <p>
                    <strong>9.4.</strong> Decorrido o prazo estabelecido no item 9.3, a LICENCIANTE procederá à <strong>exclusão definitiva</strong> dos Dados do LICENCIADO de seus servidores, não sendo possível sua recuperação posterior.
                  </p>
                  <p>
                    <strong>9.5.</strong> A LICENCIANTE poderá reter dados anonimizados e agregados para fins estatísticos, de melhoria da PLATAFORMA e de cumprimento de obrigações legais, desde que tais dados não permitam a identificação do LICENCIADO ou de terceiros.
                  </p>
                </div>
              </section>

              {/* Cláusula 10 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  10. Do Nível de Serviço (SLA)
                </h2>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  10.1. Da Disponibilidade
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>10.1.1.</strong> A LICENCIANTE compromete-se a manter a PLATAFORMA disponível para acesso com índice de disponibilidade mínimo de <strong>99,5% (noventa e nove vírgula cinco por cento)</strong> ao mês.
                  </p>
                  <p>
                    <strong>10.1.2.</strong> O cálculo de disponibilidade considera o tempo total do mês, descontados os períodos de:
                  </p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li>Manutenções programadas, comunicadas com antecedência mínima de 48 (quarenta e oito) horas;</li>
                    <li>Indisponibilidades decorrentes de caso fortuito ou força maior;</li>
                    <li>Falhas de infraestrutura de terceiros (provedores de internet, energia elétrica, etc.) fora do controle da LICENCIANTE.</li>
                  </ul>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  10.2. Do Suporte Técnico
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>10.2.1.</strong> A LICENCIANTE disponibilizará suporte técnico ao LICENCIADO por meio de:
                  </p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li>Sistema de chamados (tickets): [URL DO SISTEMA]</li>
                    <li>E-mail: [EMAIL DE SUPORTE]</li>
                  </ul>
                  <p>
                    <strong>10.2.2.</strong> O atendimento será realizado em <strong>dias úteis</strong>, das <strong>09h às 18h (horário de Brasília)</strong>, com os seguintes prazos de resposta:
                  </p>

                  {/* SLA Table */}
                  <div className="overflow-x-auto mt-4">
                    <table className="min-w-full border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                      <thead className="bg-slate-100 dark:bg-slate-800">
                        <tr>
                          <th className="px-4 py-2 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">Prioridade</th>
                          <th className="px-4 py-2 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">Descrição</th>
                          <th className="px-4 py-2 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">Prazo de Primeira Resposta</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        <tr>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 font-medium">Crítica</td>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">Plataforma totalmente indisponível</td>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">Até 2 horas úteis</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 font-medium">Alta</td>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">Funcionalidade essencial comprometida</td>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">Até 4 horas úteis</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 font-medium">Média</td>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">Funcionalidade secundária comprometida</td>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">Até 8 horas úteis</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 font-medium">Baixa</td>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">Dúvidas e solicitações gerais</td>
                          <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">Até 24 horas úteis</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <p>
                    <strong>10.2.3.</strong> Os prazos acima referem-se à primeira resposta ao chamado, não constituindo compromisso de resolução definitiva.
                  </p>
                </div>
              </section>

              {/* Cláusula 11 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  11. Da Vigência e Rescisão
                </h2>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  11.1. Da Vigência
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>11.1.1.</strong> O presente instrumento entra em vigor na data de aceite eletrônico pelo LICENCIADO e permanecerá vigente por prazo indeterminado, enquanto mantida a assinatura ativa.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  11.2. Da Rescisão Imotivada
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>11.2.1.</strong> Qualquer das partes poderá rescindir o presente instrumento, a qualquer tempo, sem necessidade de justificativa, mediante comunicação por escrito à outra parte com antecedência mínima de <strong>30 (trinta) dias</strong>.
                  </p>
                  <p>
                    <strong>11.2.2.</strong> A rescisão pelo LICENCIADO não dará direito à restituição de valores já pagos, referentes ao período de utilização já decorrido.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  11.3. Da Rescisão Motivada
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>11.3.1.</strong> Constituem motivos para rescisão imediata, independentemente de notificação prévia:
                  </p>
                  <ol className="list-[lower-alpha] list-inside ml-4 space-y-2">
                    <li>Inadimplência do LICENCIADO por período superior a 30 (trinta) dias;</li>
                    <li>Violação de cláusulas essenciais deste instrumento;</li>
                    <li>Uso da PLATAFORMA para fins ilícitos ou em desacordo com sua finalidade;</li>
                    <li>Tentativa de acesso não autorizado, engenharia reversa ou violação de segurança;</li>
                    <li>Decretação de falência, recuperação judicial ou dissolução de qualquer das partes.</li>
                  </ol>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  11.4. Dos Efeitos da Rescisão
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>11.4.1.</strong> Rescindido o contrato, por qualquer motivo:
                  </p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li>O acesso do LICENCIADO à PLATAFORMA será imediatamente suspenso;</li>
                    <li>Inicia-se o prazo de 30 (trinta) dias para exportação de dados, conforme Cláusula 9;</li>
                    <li>Permanecem vigentes as cláusulas de confidencialidade, limitação de responsabilidade e propriedade intelectual.</li>
                  </ul>
                </div>
              </section>

              {/* Cláusula 12 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  12. Das Disposições Gerais
                </h2>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  12.1. Da Comunicação
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>12.1.1.</strong> Todas as comunicações entre as partes serão realizadas por meio eletrônico, para os endereços de e-mail cadastrados, considerando-se válidas e eficazes as notificações assim realizadas.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  12.2. Da Alteração dos Termos
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>12.2.1.</strong> A LICENCIANTE poderá alterar os presentes Termos de Uso a qualquer tempo, comunicando o LICENCIADO com antecedência mínima de 30 (trinta) dias.
                  </p>
                  <p>
                    <strong>12.2.2.</strong> A continuidade do uso da PLATAFORMA após o período de comunicação prévia constituirá aceite tácito das alterações.
                  </p>
                  <p>
                    <strong>12.2.3.</strong> Caso o LICENCIADO não concorde com as alterações, poderá rescindir o contrato conforme Cláusula 11.2.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  12.3. Da Cessão
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>12.3.1.</strong> O LICENCIADO não poderá ceder ou transferir os direitos e obrigações decorrentes deste instrumento a terceiros, sem prévia autorização escrita da LICENCIANTE.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  12.4. Da Independência das Cláusulas
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>12.4.1.</strong> Se qualquer cláusula deste instrumento for considerada nula ou inexequível por decisão judicial ou administrativa, as demais cláusulas permanecerão em pleno vigor e efeito.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-3">
                  12.5. Da Tolerância
                </h3>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>12.5.1.</strong> A tolerância de qualquer das partes quanto ao descumprimento de obrigações pela outra não implicará novação, renúncia ou alteração do pactuado.
                  </p>
                </div>
              </section>

              {/* Cláusula 13 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  13. Do Foro
                </h2>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>13.1.</strong> As partes elegem o foro da Comarca de [CIDADE/UF], com exclusão de qualquer outro, por mais privilegiado que seja, para dirimir quaisquer controvérsias oriundas do presente instrumento.
                  </p>
                </div>
              </section>

              {/* Cláusula 14 */}
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                  14. Do Aceite Eletrônico
                </h2>
                <div className="space-y-4 text-slate-600 dark:text-slate-300">
                  <p>
                    <strong>14.1.</strong> O LICENCIADO declara ter lido, compreendido e aceito integralmente os presentes Termos de Uso, manifestando sua concordância por meio de aceite eletrônico (checkbox ou clique em botão "Aceito") no momento do cadastro na PLATAFORMA.
                  </p>
                  <p>
                    <strong>14.2.</strong> O aceite eletrônico tem validade jurídica equivalente à assinatura física, nos termos do art. 10, §2º, da Medida Provisória nº 2.200-2/2001.
                  </p>
                </div>
              </section>

            </div>

            {/* Footer Info */}
            <div className="mt-12 pt-8 border-t border-slate-200 dark:border-slate-800">
              <div className="text-center text-slate-500 dark:text-slate-400 text-sm space-y-2">
                <p className="font-semibold text-slate-700 dark:text-slate-300">[RAZÃO SOCIAL DA LICENCIANTE]</p>
                <p>CNPJ: [XX.XXX.XXX/0001-XX]</p>
                <p>[ENDEREÇO COMPLETO]</p>
                <p>[CIDADE/UF — CEP]</p>
                <p>Contato: [EMAIL COMERCIAL]</p>
              </div>
              <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
                Documento gerado eletronicamente. A versão vigente e atualizada deste instrumento estará sempre disponível nesta página.
              </p>
            </div>

          </article>
        </main>

        {/* Page Footer */}
        <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-6">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              /termos-de-uso
            </p>
          </div>
        </footer>
      </div>
    </>
  )
}
