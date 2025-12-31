import React from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';

const CTA: React.FC = () => {
  return (
    <section className="py-20 relative overflow-hidden">
      <div className="absolute inset-0 bg-sky-600 dark:bg-sky-900 z-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff12_1px,transparent_1px),linear-gradient(to_bottom,#ffffff12_1px,transparent_1px)] bg-[size:24px_24px] opacity-30"></div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 tracking-tight">
          Pronto para modernizar seu laboratório?
        </h2>
        <p className="text-xl text-sky-100 mb-10 max-w-2xl mx-auto">
          Junte-se à maior rede de laboratórios acreditados que já confiam no CalibraFácil para sua gestão metrológica.
        </p>

        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Button size="lg" className="bg-white text-sky-700 hover:bg-sky-50 shadow-lg shadow-sky-900/20 rounded-full h-14 px-8 text-base font-bold">
            Teste Grátis por 14 dias
            <HugeiconsIcon icon={ArrowRight01Icon} className="ml-2" size={20} />
          </Button>
          <Button size="lg" variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white rounded-full h-14 px-8 text-base font-bold">
            Agendar Demonstração
          </Button>
        </div>
      </div>
    </section>
  );
};

export default CTA;
