"use client";

import React from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, CheckmarkCircle02Icon, FileIcon } from '@hugeicons/core-free-icons';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import FloatingLines from './floating-lines';
import { Link } from '@tanstack/react-router';

const Hero: React.FC = () => {

    return (
        <section className="relative pt-32 pb-10 lg:pt-48 lg:pb-20 overflow-hidden min-h-[80vh] bg-white dark:bg-transparent">
            {/* FloatingLines - only in dark mode */}
            <div
                className="absolute top-0 left-0 w-full pointer-events-none hidden dark:block"
                style={{ height: '100%', minHeight: '600px', zIndex: 0 }}
            >
                <FloatingLines
                    linesGradient={['#3b82f6', '#06b6d4', '#8b5cf6']}
                    enabledWaves={['top', 'middle', 'bottom']}
                    lineCount={[10, 15, 20]}
                    lineDistance={[8, 6, 4]}
                    bendRadius={5.0}
                    bendStrength={-0.5}
                    interactive={true}
                    parallax={true}
                    mixBlendMode="normal"
                />
            </div>

            {/* Dark mode vignette for text readability */}
            <div
                className="absolute inset-0 pointer-events-none hidden dark:block"
                style={{
                    zIndex: 1,
                    background: 'radial-gradient(ellipse at center, rgba(2, 6, 23, 0.7) 0%, rgba(2, 6, 23, 0.4) 50%, transparent 80%)'
                }}
            />

            {/* Bottom gradient fade */}
            <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-white dark:from-slate-950 to-transparent" style={{ zIndex: 2 }} />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative" style={{ zIndex: 10 }}>
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="mb-6"
                >
                    <Badge variant="outline" className="gap-2 px-3 py-1 text-sm font-medium border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400">
                        <span className="flex h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>
                        Em conformidade com a ISO/IEC 17025:2017
                    </Badge>
                </motion.div>

                <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-slate-900 dark:text-white mb-6"
                >
                    Gestão de Calibração <br className="hidden md:block" />
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-sky-600 via-cyan-500 to-indigo-600 dark:from-sky-300 dark:via-cyan-300 dark:to-indigo-300">Sem Complicações</span>
                </motion.h1>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="max-w-3xl mx-auto text-lg md:text-xl text-slate-600 dark:text-slate-300 mb-10 leading-relaxed"
                >
                    O dashboard definitivo para laboratórios acreditados RBC/Inmetro.
                    Automatize certificados, gerencie equipamentos e ofereça um portal
                    premium para seus clientes.
                </motion.p>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="flex flex-col sm:flex-row items-center justify-center gap-4"
                >
                    <Button size="lg" className="h-14 px-8 text-base font-bold rounded-full hover:scale-105 transition-transform bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-200" render={<Link to="/sign-in" className='inline-flex items-center' />}>
                        Começar Agora
                        <HugeiconsIcon icon={ArrowRight01Icon} className="ml-2" size={20} />
                    </Button>
                    <Button size="lg" variant="outline" className="text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 rounded-full h-14 px-8 text-base font-bold" render={<a href="https://docs.calibrafacil.com" className="inline-flex items-center" />}>
                        <HugeiconsIcon icon={FileIcon} size={20} className="mr-2" />
                        Ver Documentação
                    </Button>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 1, delay: 0.5 }}
                    className="mt-10 flex items-center justify-center gap-6 text-sm"
                >
                    <div className="flex items-center gap-2">
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="text-sky-500" />
                        <span className="text-slate-600 dark:text-slate-300">Certificados Digitais</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="text-sky-500" />
                        <span className="text-slate-600 dark:text-slate-300">Backup Automático</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="text-sky-500" />
                        <span className="text-slate-600 dark:text-slate-300">Setup Rápido</span>
                    </div>
                </motion.div>
            </div>
        </section>
    );
};

export default Hero;
