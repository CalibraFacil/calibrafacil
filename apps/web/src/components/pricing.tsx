import React from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from '@hugeicons/core-free-icons';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const plans = [
  {
    name: 'Iniciante',
    price: 'R$ 299',
    description: 'Ideal para laboratórios pequenos iniciando a acreditação.',
    features: [
      'Até 500 certificados/mês',
      '2 Usuários técnicos',
      'Portal do cliente básico',
      'Suporte por e-mail',
    ],
    popular: false,
  },
  {
    name: 'Profissional',
    price: 'R$ 599',
    description: 'Para laboratórios RBC em crescimento constante.',
    features: [
      'Certificados ilimitados',
      '5 Usuários técnicos',
      'Portal do cliente White-label',
      'Cálculo de Incerteza Avançado',
      'Suporte Prioritário',
    ],
    popular: true,
  },
  {
    name: 'Enterprise',
    price: 'Sob Consulta',
    description: 'Para grandes redes de laboratórios e metrologia industrial.',
    features: [
      'Múltiplas Unidades',
      'API de Integração',
      'SSO (Single Sign-On)',
      'Gerente de Conta Dedicado',
      'SLA Garantido',
    ],
    popular: false,
  },
];

const Pricing: React.FC = () => {
  return (
    <section id="pricing" className="py-24 bg-white dark:bg-slate-950 border-t border-slate-100 dark:border-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
            Preços transparentes
          </h2>
          <p className="text-lg text-slate-600 dark:text-slate-400">
            Escolha o plano que melhor se adapta ao volume de calibrações do seu laboratório.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={`relative flex flex-col ${plan.popular
                  ? 'border-sky-500 shadow-xl shadow-sky-900/10 dark:shadow-sky-900/20 scale-105 z-10 bg-white dark:bg-slate-900'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50'
                }`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                  <Badge className="bg-sky-500 hover:bg-sky-500 text-white font-bold uppercase tracking-wide rounded-full">
                    Mais Popular
                  </Badge>
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-xl font-bold text-slate-900 dark:text-white mb-2">{plan.name}</CardTitle>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-4xl font-bold text-slate-900 dark:text-white">{plan.price}</span>
                  <span className="text-slate-500 dark:text-slate-400">/mês</span>
                </div>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400">{plan.description}</CardDescription>
              </CardHeader>

              <CardContent className="flex-1">
                <ul className="space-y-4">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
                      <HugeiconsIcon icon={Tick02Icon} className="text-sky-500 shrink-0" size={18} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter>
                <Button
                  className={`w-full font-semibold ${plan.popular
                      ? 'bg-sky-600 hover:bg-sky-500 text-white'
                      : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200'
                    }`}
                >
                  Escolher {plan.name}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Pricing;
