import React, { useState, useEffect } from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import { Menu01Icon, Cancel01Icon, KnightShieldIcon } from '@hugeicons/core-free-icons';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { ModeToggle } from './mode-toggle';
import { useIsMobile } from '@/hooks/use-mobile';
import { Link } from '@tanstack/react-router';

const Navbar: React.FC = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'Recursos', href: '#features' },
    { name: 'Clientes', href: '#trusted-by' },
    { name: 'Preços', href: '#pricing' },
    { name: 'Contato', href: '#footer' },
  ];

  return (
    <nav
      className={`fixed top-0 w-full z-50 transition-all duration-300 border-b ${scrolled
        ? 'bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-slate-200 dark:border-slate-800 py-3'
        : 'bg-transparent border-transparent py-5'
        }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2 group cursor-pointer" onClick={() => window.scrollTo(0, 0)}>
          <div className="bg-sky-600 text-white p-1.5 rounded-lg group-hover:bg-sky-500 transition-colors">
            <HugeiconsIcon icon={KnightShieldIcon} size={24} strokeWidth={2.5} />
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            Calibra<span className="text-sky-600">Fácil</span>
          </span>
        </div>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center space-x-8">
          {navLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              className="text-sm font-medium text-slate-600 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 transition-colors"
            >
              {link.name}
            </a>
          ))}
        </div>

        {/* Actions */}
        <div className="hidden md:flex items-center space-x-4">
          <ModeToggle />
          <Button variant="ghost" render={<Link to="/sign-in" />}>
            Login
          </Button>
          <Button className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 rounded-full">
            <Link to="/sign-in">Começar Grátis</Link>
          </Button>
        </div>

        {/* Mobile Menu Button */}
        {isMobile && (
          <div className="md:hidden flex items-center gap-4">
            <ModeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <HugeiconsIcon icon={Cancel01Icon} size={24} /> : <HugeiconsIcon icon={Menu01Icon} size={24} />}
            </Button>
          </div>
        )}
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobile && mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            <div className="px-4 pt-2 pb-6 space-y-2">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 rounded-md text-base font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 hover:text-sky-600"
                >
                  {link.name}
                </a>
              ))}
              <div className="pt-4 mt-4 border-t border-slate-200 dark:border-slate-800 grid gap-2">
                <Button variant="ghost" render={<Link to="/sign-in" />}>
                  Login
                </Button>
                <Button className="w-full justify-center bg-sky-600 hover:bg-sky-500 text-white">
                  <Link to="/sign-in">Começar Grátis</Link>
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default Navbar;
