import React from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import {
  InstagramIcon,
  FacebookIcon,
  LinkedinIcon,
  KnightShieldIcon,
} from "@hugeicons/core-free-icons";

const Footer: React.FC = () => {
  return (
    <footer id="footer" className="bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-900 pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div className="col-span-1 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="bg-sky-600 text-white p-1 rounded-lg">
                <HugeiconsIcon icon={KnightShieldIcon} size={20} strokeWidth={2.5} />
              </div>
              <span className="text-lg font-bold text-slate-900 dark:text-white">
                Calibra<span className="text-sky-600">Fácil</span>
              </span>
            </div>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
              A plataforma de gestão definitiva para laboratórios de metrologia e calibração.
            </p>
            <div className="flex space-x-4">
              <a href="https://linkedin.com/in/calibrafacil" className="text-slate-400 hover:text-sky-500"><HugeiconsIcon icon={LinkedinIcon} size={20} /></a>
              <a href="https://facebook.com/calibrafacil" className="text-slate-400 hover:text-sky-500"><HugeiconsIcon icon={FacebookIcon} size={20} /></a>
              <a href="https://instagram.com/calibrafacil" className="text-slate-400 hover:text-sky-500"><HugeiconsIcon icon={InstagramIcon} size={20} /></a>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-slate-900 dark:text-white mb-4">Produto</h4>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
              <li><a href="#" className="hover:text-sky-500">Recursos</a></li>
              <li><a href="#" className="hover:text-sky-500">Preços</a></li>
              <li><a href="#" className="hover:text-sky-500">Portal do Cliente</a></li>
              <li><a href="#" className="hover:text-sky-500">Atualizações</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-slate-900 dark:text-white mb-4">Recursos</h4>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
              <li><a href="#" className="hover:text-sky-500">Documentação</a></li>
              <li><a href="#" className="hover:text-sky-500">Guia ISO 17025</a></li>
              <li><a href="#" className="hover:text-sky-500">Blog</a></li>
              <li><a href="#" className="hover:text-sky-500">Suporte</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-slate-900 dark:text-white mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
              <li><a href="#" className="hover:text-sky-500">Privacidade</a></li>
              <li><a href="#" className="hover:text-sky-500">Termos de Uso</a></li>
              <li><a href="#" className="hover:text-sky-500">Segurança</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-900 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-slate-500 dark:text-slate-500">
            © 2025 CalibraFácil. Todos os direitos reservados.
          </p>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
            <span className="text-sm text-slate-500 font-medium">Sistemas Operacionais</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
