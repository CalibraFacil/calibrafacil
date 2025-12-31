"use client";

import React from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AnalyticsUpIcon,
  UserGroupIcon,
  Settings01Icon,
  FileValidationIcon,
  Notification03Icon,
  SearchIcon,
  MoreHorizontalIcon,
  CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons';
import { motion } from 'motion/react';
import { BarChart as ReBarChart, Bar, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { useTheme } from 'next-themes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const data = [
  { name: 'Seg', value: 12 },
  { name: 'Ter', value: 19 },
  { name: 'Qua', value: 15 },
  { name: 'Qui', value: 24 },
  { name: 'Sex', value: 32 },
  { name: 'Sáb', value: 20 },
];

const sidebarItems = [
  { icon: AnalyticsUpIcon, label: 'Visão Geral', active: true },
  { icon: FileValidationIcon, label: 'Certificados', active: false },
  { icon: UserGroupIcon, label: 'Clientes', active: false },
  { icon: Settings01Icon, label: 'Configurações', active: false },
];

const DashboardPreview: React.FC = () => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme ? resolvedTheme === 'dark' : true;

  return (
    <section className="relative pb-20 px-4 -mt-4">
      <div className="max-w-6xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7 }}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl shadow-sky-900/20 overflow-hidden relative"
        >
          {/* Fake Browser Header */}
          <div className="h-12 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center px-4 gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
              <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
              <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
            </div>
            <div className="ml-4 flex-1 max-w-xl bg-white dark:bg-slate-900 h-8 rounded-md border border-slate-200 dark:border-slate-800 flex items-center px-3 text-xs text-slate-400">
              <HugeiconsIcon icon={SearchIcon} size={12} className="mr-2" />
              app.calibrafacil.com/dashboard
            </div>
          </div>

          {/* Dashboard Layout */}
          <div className="flex h-[500px] md:h-[600px] overflow-hidden">
            {/* Sidebar */}
            <div className="w-16 md:w-64 border-r border-slate-200 dark:border-slate-800 p-4 flex-col gap-2 hidden sm:flex bg-slate-50/50 dark:bg-slate-950/50">
              <div className="h-8 w-8 rounded-lg bg-sky-600 mb-6 flex items-center justify-center text-white font-bold">C</div>

              {sidebarItems.map((item, idx) => (
                <Button
                  key={idx}
                  variant="ghost"
                  className={`w-full justify-start gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${item.active
                    ? 'bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/40'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                >
                  <HugeiconsIcon icon={item.icon} size={18} />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{item.label}</span>
                </Button>
              ))}
            </div>

            {/* Main Content */}
            <div className="flex-1 p-4 md:p-8 bg-slate-50/30 dark:bg-black/20 overflow-y-auto">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Bom dia, Laboratório X</h2>
                  <p className="text-sm text-slate-500">Resumo das operações de hoje.</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Notificações"
                >
                  <HugeiconsIcon icon={Notification03Icon} size={20} />
                </Button>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {[
                  { label: 'Calibrações Hoje', value: '24', color: 'text-emerald-500', change: '+12%' },
                  { label: 'Certificados Emitidos', value: '1,204', color: 'text-sky-500', change: '+5%' },
                  { label: 'Aguardando Aprovação', value: '8', color: 'text-amber-500', change: '-2%' },
                ].map((stat, idx) => (
                  <Card
                    key={idx}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl"
                  >
                    <CardContent className="p-6">
                      <div className="text-sm text-slate-500 mb-1">{stat.label}</div>
                      <div className="text-2xl font-bold text-slate-900 dark:text-white flex justify-between items-end">
                        {stat.value}
                        <Badge variant="secondary" className={`rounded-full ${stat.color} bg-slate-100 dark:bg-slate-800`}>
                          {stat.change}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Content Area */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl h-80 flex flex-col">
                  <CardHeader className="px-6 pt-6 pb-2">
                    <CardTitle className="text-sm font-semibold text-slate-900 dark:text-white">Volume de Calibrações (Semanal)</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 w-full px-6 pb-6 pt-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <ReBarChart data={data}>
                        <XAxis
                          dataKey="name"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: isDark ? '#94a3b8' : '#64748b', fontSize: 12 }}
                          dy={10}
                        />
                        <Tooltip
                          cursor={{ fill: isDark ? '#1e293b' : '#f1f5f9' }}
                          contentStyle={{
                            backgroundColor: isDark ? '#0f172a' : '#fff',
                            borderColor: isDark ? '#334155' : '#e2e8f0',
                            borderRadius: '8px',
                            color: isDark ? '#fff' : '#0f172a'
                          }}
                        />
                        <Bar
                          dataKey="value"
                          fill="#0ea5e9"
                          radius={[4, 4, 0, 0]}
                          barSize={40}
                        />
                      </ReBarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl h-80 overflow-hidden">
                  <CardHeader className="px-6 pt-6 pb-2">
                    <CardTitle className="text-sm font-semibold text-slate-900 dark:text-white">Atividades Recentes</CardTitle>
                  </CardHeader>
                  <CardContent className="px-6 pb-6 pt-2">
                    <div className="space-y-4">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
                          <div className="w-8 h-8 rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center text-sky-600 dark:text-sky-400 text-xs font-bold">
                            OS
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-white truncate">Certificado #{2024000 + i}</div>
                            <div className="text-xs text-slate-500">Micrômetro Externo - Cliente A</div>
                          </div>
                          <HugeiconsIcon icon={MoreHorizontalIcon} size={16} className="text-slate-400" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

            </div>
          </div>
        </motion.div>

        {/* Floating Elements for 3D Effect */}
        <motion.div
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -right-4 top-20 md:right-10 md:top-40 z-20 hidden lg:block"
          style={{ transform: 'translateX(50%)' }}
        >
          <Card className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 max-w-[200px]">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-md">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={20} />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900 dark:text-white">Aprovação Automática</p>
                <p className="text-[10px] text-slate-500 mt-1">Certificado em conformidade com Inmetro.</p>
              </div>
            </div>
          </Card>
        </motion.div>

      </div>
    </section>
  );
};

export default DashboardPreview;
