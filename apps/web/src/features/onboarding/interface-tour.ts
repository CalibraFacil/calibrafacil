import { startTour, type TourStep } from './tour'

/**
 * A walk through the main areas, offered from the activation checklist and
 * the user menu. Short on purpose: it names where things live and why, and
 * leaves the doing to the checklist.
 */
export const INTERFACE_TOUR: TourStep[] = [
  {
    title: 'Conheça o CalibraFácil',
    description:
      'Um passeio pelas áreas principais em menos de um minuto. Use as setas do teclado para avançar e Esc para sair.',
  },
  {
    target: 'nav-customers',
    title: 'Clientes',
    description:
      'Cada cliente com seus equipamentos, contatos e o acesso ao portal, onde ele acompanha prazos e baixa os certificados.',
  },
  {
    target: 'nav-building',
    title: 'Laboratório',
    description:
      'Métodos de calibração, padrões de referência e competências do pessoal: a base técnica que a ISO/IEC 17025 pede.',
  },
  {
    target: 'nav-jobs',
    title: 'Calibrações',
    description:
      'Cada calibração passa por preparação, execução, revisão técnica e emissão do certificado assinado.',
  },
  {
    target: 'nav-serviceOrders',
    title: 'Ordens de serviço',
    description:
      'Do pedido do cliente à devolução do equipamento: recebimento, orçamento e entrega.',
  },
  {
    target: 'nav-quality',
    title: 'Qualidade',
    description:
      'Não conformidades, ações corretivas, ensaios de proficiência e cartas de controle.',
  },
  {
    target: 'search',
    title: 'Busca',
    description:
      'Encontre clientes, equipamentos e calibrações de qualquer tela, também pelo atalho Ctrl+K (⌘K no Mac).',
  },
  {
    target: 'new-calibration',
    title: 'Nova calibração',
    description: 'Abre uma calibração para um equipamento de cliente.',
    side: 'bottom',
    align: 'end',
  },
  {
    target: 'activation-checklist',
    title: 'Primeiros passos',
    description:
      'O que falta para emitir o primeiro certificado. Cada item abre a tela onde ele é resolvido.',
  },
  {
    target: 'nav-documentation',
    title: 'Documentação',
    description:
      'O guia de uso, tela por tela, e os conceitos por trás de cada uma.',
  },
]

export function startInterfaceTour(): void {
  startTour(INTERFACE_TOUR)
}
