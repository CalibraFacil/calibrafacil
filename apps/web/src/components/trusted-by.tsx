import React from 'react';

const TrustedBy: React.FC = () => {
  return (
    <section id="trusted-by" className="py-16 border-y border-slate-100 dark:border-slate-900/50 bg-white dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-8">
          Projetado para laboratórios que exigem excelência e conformidade
        </p>
        <div className="flex flex-wrap justify-center items-center gap-x-12 gap-y-8 opacity-70 grayscale transition-all duration-500 hover:grayscale-0 hover:opacity-100">
          {/* Mock Logos using text for simplicity but styled like logos */}
          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold text-slate-800 dark:text-slate-200">ISO/IEC</div>
            <div className="px-2 py-0.5 bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 text-xs font-bold rounded">17025</div>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-xl font-black tracking-tighter text-slate-700 dark:text-slate-300">RBC</span>
            <span className="text-xs uppercase tracking-widest text-slate-500 border-l border-slate-300 pl-2 ml-2">Acreditado</span>
          </div>

          <div className="h-8 border-l border-slate-300 dark:border-slate-700 mx-4 hidden md:block"></div>

          {/* Fictional Clients */}
          <span className="text-lg font-semibold text-slate-600 dark:text-slate-400">TechLab Sul</span>
          <span className="text-lg font-semibold text-slate-600 dark:text-slate-400">MetroQuali</span>
          <span className="text-lg font-semibold text-slate-600 dark:text-slate-400">PadrãoExato</span>
        </div>
      </div>
    </section>
  );
};

export default TrustedBy;
