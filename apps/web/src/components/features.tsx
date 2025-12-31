import React from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CertificateIcon,
  GlobalIcon,
  DatabaseIcon,
  SecurityCheckIcon,
  FlashIcon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Link } from '@tanstack/react-router';

const Features: React.FC = () => {
  return (
    <section id="features" className="py-24 bg-slate-50 dark:bg-[#0B1120]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
            Tudo que seu laboratório precisa
          </h2>
          <p className="text-lg text-slate-600 dark:text-slate-400">
            Otimize o fluxo de trabalho do seu laboratório com ferramentas desenhadas especificamente para atender às normas da RBC e Inmetro.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Large Item */}
          <Card className="md:col-span-2 overflow-hidden relative hover:shadow-md transition-shadow group border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-sm">
            <CardContent className="p-8 relative z-10">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4 group-hover:scale-110 transition-transform">
                <HugeiconsIcon icon={GlobalIcon} size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Portal do Cliente Premium</h3>
              <p className="text-slate-600 dark:text-slate-400 max-w-md">
                Ofereça aos seus clientes acesso 24/7 aos certificados digitais. Eles podem baixar PDFs, consultar históricos e solicitar novos serviços diretamente pelo portal.
              </p>
            </CardContent>
            <div className="absolute right-0 bottom-0 w-1/2 h-3/4 bg-gradient-to-tl from-sky-50 to-transparent dark:from-sky-900/10 rounded-tl-3xl border-t border-l border-slate-100 dark:border-slate-800 translate-x-4 translate-y-4 opacity-50">
              {/* Abstract UI decoration */}
              <div className="p-4 space-y-3">
                <div className="h-8 w-3/4 bg-white dark:bg-slate-800 rounded shadow-sm"></div>
                <div className="h-8 w-full bg-white dark:bg-slate-800 rounded shadow-sm"></div>
                <div className="h-8 w-5/6 bg-white dark:bg-slate-800 rounded shadow-sm"></div>
              </div>
            </div>
          </Card>

          {/* Tall Item */}
          <Card className="md:row-span-2 bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow group">
            <CardContent className="p-8">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 group-hover:scale-110 transition-transform">
                <HugeiconsIcon icon={CertificateIcon} size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Certificados Automatizados</h3>
              <p className="text-slate-600 dark:text-slate-400 mb-6">
                Geração automática de certificados com cálculo de incerteza integrado. Templates personalizáveis para atender ISO 17025.
              </p>
              <ul className="space-y-3 text-sm text-slate-500 dark:text-slate-400">
                <li className="flex items-center gap-2"><HugeiconsIcon icon={FlashIcon} size={16} className="text-emerald-500" /> Assinatura Digital</li>
                <li className="flex items-center gap-2"><HugeiconsIcon icon={FlashIcon} size={16} className="text-emerald-500" /> QR Code de Validação</li>
                <li className="flex items-center gap-2"><HugeiconsIcon icon={FlashIcon} size={16} className="text-emerald-500" /> Envio por E-mail</li>
              </ul>
            </CardContent>
          </Card>

          {/* Small Item 1 */}
          <Card className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow group">
            <CardContent className="p-8">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center text-purple-600 dark:text-purple-400 mb-4 group-hover:scale-110 transition-transform">
                <HugeiconsIcon icon={DatabaseIcon} size={24} />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Gestão de Ativos</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Controle total sobre os padrões do laboratório e equipamentos dos clientes.
              </p>
            </CardContent>
          </Card>

          {/* Small Item 2 */}
          <Card className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow group">
            <CardContent className="p-8">
              <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center text-amber-600 dark:text-amber-400 mb-4 group-hover:scale-110 transition-transform">
                <HugeiconsIcon icon={SecurityCheckIcon} size={24} />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Audit Ready</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Trilhas de auditoria completas. Esteja sempre pronto para a visita do Inmetro.
              </p>
            </CardContent>
          </Card>

          {/* Wide Bottom Item - Updated description */}
          <Card className="md:col-span-3 bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-800 dark:to-slate-900 border-slate-200 dark:border-slate-700 text-white">
            <CardContent className="p-8 flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <HugeiconsIcon icon={Settings01Icon} className="text-sky-400" size={24} />
                  <h3 className="text-xl font-bold">Editor de Métodos Configurável</h3>
                </div>
                <p className="text-slate-300 max-w-2xl">
                  Configure métodos de calibração personalizados com campos de entrada, fórmulas matemáticas e critérios de aceitação. Defina variáveis, cálculos automáticos e regras de validação para cada grandeza.
                </p>
              </div>
              <Button className="bg-sky-500 hover:bg-sky-400 text-white whitespace-nowrap" render={<Link to="/sign-in" />}>
                Ver Demonstração
              </Button>
            </CardContent>
          </Card>

        </div>
      </div>
    </section>
  );
};

export default Features;
