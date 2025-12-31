import React from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

const faqs = [
  {
    question: "O sistema atende aos requisitos da ABNT NBR ISO/IEC 17025:2017?",
    answer: "Sim, o CalibraFácil foi desenvolvido especificamente para atender os requisitos da norma, incluindo controle de alterações, validação de métodos, cálculo de incerteza e gestão de riscos."
  },
  {
    question: "Como funciona a rastreabilidade de dados?",
    answer: "Todos os dados são registrados diretamente no sistema durante a execução das calibrações. Cada alteração gera um registro automático no audit-log, garantindo rastreabilidade completa exigida pela ISO 17025."
  },
  {
    question: "O portal do cliente pode ter a minha logomarca?",
    answer: "Absolutamente. Você pode personalizar o portal do cliente com sua logo, cores e domínio personalizado (ex: portal.seulaboratorio.com.br)."
  },
  {
    question: "Como funciona o cálculo de incerteza?",
    answer: "O sistema possui um motor matemático onde você configura as fontes de incerteza, graus de liberdade e tipos de distribuição. O cálculo é feito automaticamente durante a entrada de dados da calibração."
  },
];

const FAQ: React.FC = () => {
  return (
    <section className="py-24 bg-slate-50 dark:bg-[#0B1120]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold text-center text-slate-900 dark:text-white mb-12">
          Dúvidas Frequentes
        </h2>

        <Accordion itemType="single" className="w-full space-y-4">
          {faqs.map((faq, index) => (
            <AccordionItem
              key={index}
              value={`item-${index}`}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden px-2"
            >
              <AccordionTrigger className="px-4 hover:no-underline text-slate-900 dark:text-white font-medium">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="px-4 text-slate-600 dark:text-slate-400">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
};

export default FAQ;
