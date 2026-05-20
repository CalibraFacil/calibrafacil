import { motion } from 'motion/react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

const faqItems = [
  {
    question: 'O CalibraFácil atende os requisitos da ISO/IEC 17025?',
    answer:
      'Sim. A plataforma foi projetada com base nos requisitos de sistemas de gestão de laboratórios da norma ISO/IEC 17025. Isso inclui rastreabilidade metrológica dos padrões de referência, trilha de auditoria completa para todas as ações, controle de revisões de certificados, gestão de não conformidades e ações corretivas (CAPA), e fluxos de aprovação configuráveis. O objetivo é facilitar a manutenção da conformidade normativa e a preparação para auditorias de acreditação.',
  },
  {
    question: 'Como funciona o cálculo de incerteza de medição?',
    answer:
      'O CalibraFácil utiliza um motor de cálculo próprio que implementa o método descrito no GUM (Guide to the Expression of Uncertainty in Measurement). O sistema calcula automaticamente as contribuições de incerteza Tipo A e Tipo B, realiza a composição pelo método das incertezas combinadas, aplica o fator de abrangência adequado e determina a incerteza expandida. Os cálculos são incorporados diretamente nos certificados de calibração, eliminando planilhas manuais e reduzindo o risco de erros.',
  },
  {
    question: 'Quais grandezas de calibração são suportadas?',
    answer:
      'A plataforma suporta calibração em diversas grandezas, incluindo massa, temperatura, pressão, dimensional (comprimento), volume, umidade, força, torque e grandezas elétricas, entre outras. O editor de métodos é flexível e permite configurar procedimentos de calibração para qualquer grandeza, definindo pontos de calibração, critérios de aceitação e fórmulas de cálculo personalizadas.',
  },
  {
    question: 'Meus clientes podem acessar os certificados diretamente?',
    answer:
      'Sim. O CalibraFácil oferece um Portal do Cliente onde seus clientes podem acompanhar o status das calibrações em andamento, baixar certificados emitidos em formato PDF, consultar o histórico completo de calibrações de seus instrumentos e receber notificações automáticas quando um certificado estiver pronto ou quando um instrumento estiver próximo do vencimento de calibração.',
  },
  {
    question: 'Como é garantida a segurança e integridade dos dados?',
    answer:
      'A infraestrutura do CalibraFácil utiliza criptografia em trânsito e em repouso, backups automáticos, controle de acesso baseado em funções (RBAC) e trilha de auditoria imutável. Todas as alterações em certificados e dados críticos são registradas com identificação do usuário, data e hora, garantindo a integridade e a rastreabilidade exigidas pelos organismos de acreditação.',
  },
  {
    question:
      'É possível personalizar os certificados com a identidade visual do meu laboratório?',
    answer:
      'Sim. Os certificados podem ser personalizados com o logotipo do laboratório, informações de contato, escopo de acreditação e layout customizado. O sistema gera certificados em formato PDF com aparência profissional, incluindo todas as informações obrigatórias segundo as normas vigentes, como identificação do instrumento, condições ambientais, resultados de medição e declaração de incerteza.',
  },
  {
    question:
      'O CalibraFácil gerencia padrões de referência e rastreabilidade?',
    answer:
      'Sim. A plataforma permite cadastrar todos os padrões de referência do laboratório, registrar seus certificados de calibração, controlar intervalos de recalibração e manter a cadeia de rastreabilidade metrológica. Quando um certificado é emitido, os padrões utilizados são automaticamente vinculados, garantindo a rastreabilidade completa exigida para acreditação.',
  },
  {
    question: 'Como posso conhecer melhor a plataforma?',
    answer:
      'Você pode agendar uma demonstração personalizada com nossa equipe. Na demonstração, apresentamos as funcionalidades da plataforma aplicadas ao contexto do seu laboratório, respondemos suas dúvidas técnicas e discutimos como o CalibraFácil pode otimizar seus processos de calibração. Acesse o link "Agendar Demonstração" para escolher o melhor horário.',
  },
]

export function FAQ() {
  return (
    <section id="faq" className="relative py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.4 }}
            className="text-sm font-medium tracking-wide text-primary uppercase"
          >
            FAQ
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Perguntas frequentes
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="mt-4 text-base text-muted-foreground"
          >
            Tudo que você precisa saber sobre a plataforma e como ela se adequa
            ao seu laboratório.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mx-auto mt-12 max-w-3xl"
        >
          <Accordion>
            {faqItems.map((item, i) => (
              <AccordionItem key={i} value={String(i)}>
                <AccordionTrigger>{item.question}</AccordionTrigger>
                <AccordionContent>
                  <p className="text-muted-foreground">{item.answer}</p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  )
}
