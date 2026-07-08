import type {
  ContentFaq,
  ContentLink,
  ContentPoint,
  ContentSpec,
  ContentStep,
} from "@/components/content-page";

// Per-magnitude ("grandeza") calibration pages, rendered at /calibracao/[slug].
// Each targets a distinct high-intent search ("calibração de balança", etc.)
// with substantive, method-accurate content. The software is agnostic to the
// method; the laboratory owns the method — the copy never asserts a certified
// result, only how the platform supports the work.

export interface Grandeza {
  slug: string;
  metaTitle: string;
  description: string;
  heading: string;
  intro: string;
  body?: string[];
  method: ContentStep[];
  points: ContentPoint[];
  spec: ContentSpec[];
  faq: ContentFaq[];
  related: ContentLink[];
}

export const GRANDEZAS: Grandeza[] = [
  {
    slug: "balanca",
    metaTitle: "Software para calibração de balança (massa)",
    description:
      "Sistema para laboratórios que calibram balanças: pontos de calibração na faixa, ensaios de repetibilidade e excentricidade, orçamento de incerteza conforme o GUM e certificado assinado em ICP-Brasil.",
    heading: "Calibração de balança",
    intro:
      "Para o laboratório que calibra instrumentos de pesagem: o CalibraFácil conduz a calibração de balança do registro das indicações ao certificado assinado, com o orçamento de incerteza montado conforme o GUM — sem planilha paralela e sem recomeçar a cada revisão.",
    body: [
      "A calibração de uma balança compara as indicações do instrumento contra cargas de massa conhecida — os pesos-padrão do laboratório — em pontos ao longo da faixa. O que separa um certificado defensável de uma planilha é a evidência: cada erro de indicação, cada componente da incerteza e cada padrão usado precisam ficar registrados e reconstruíveis pelo avaliador.",
      "O CalibraFácil registra os pontos, calcula a incerteza a partir dos componentes que você mede (não de um número fixo) e gera o certificado a partir do modelo Excel do próprio laboratório. O laboratório continua dono do método; o sistema garante a rastreabilidade e o controle de documentos que a ISO/IEC 17025 exige.",
    ],
    method: [
      {
        title: "Preparação e estabilização",
        body: "Condições ambientais e estabilização registradas com a calibração — temperatura e o que mais o método do laboratório exigir.",
      },
      {
        title: "Pontos ao longo da faixa",
        body: "O laboratório define as cargas do mínimo à capacidade máxima; o sistema registra a indicação e o erro em cada ponto.",
      },
      {
        title: "Repetibilidade (Tipo A)",
        body: "Repetições numa mesma carga; o desvio-padrão entra no orçamento como contribuição Tipo A, ligado à medição.",
      },
      {
        title: "Excentricidade",
        body: "Ensaio de carga fora de centro nas posições do prato, com o maior desvio registrado como componente da incerteza.",
      },
      {
        title: "Orçamento de incerteza (GUM)",
        body: "Repetibilidade, resolução, excentricidade, deriva do padrão e demais fontes compostas quadraticamente até a incerteza expandida (k=2).",
      },
      {
        title: "Certificado assinado",
        body: "A aprovação congela o PDF e o assina em ICP-Brasil (PAdES A1, carimbo de tempo). A versão aprovada não muda mais.",
      },
    ],
    points: [
      {
        title: "Modelo de massa que você edita",
        body: "O layout do certificado de balança é uma planilha do próprio laboratório; o sistema preenche as variáveis nomeadas e gera o PDF.",
      },
      {
        title: "Padrões rastreáveis",
        body: "Pesos-padrão classe E2/F1 (OIML R 111) cadastrados com seu certificado; o valor e a incerteza do padrão entram no orçamento e o vencimento é controlado.",
      },
      {
        title: "Portal do cliente",
        body: "O cliente baixa o certificado da balança, confere a validade e recebe aviso antes de a calibração vencer — sem abrir chamado.",
      },
      {
        title: "Vencimentos e recall",
        body: "Intervalo por instrumento e alerta automático antes do vencimento, para o laboratório e para o cliente.",
      },
    ],
    spec: [
      { label: "Grandeza", value: "Massa" },
      {
        label: "Faixa típica",
        value: "De balanças analíticas (mg) a balanças de grande capacidade (t)",
      },
      {
        label: "Padrões de referência",
        value: "Pesos-padrão classe E2 / F1 (OIML R 111), rastreáveis à RBC",
      },
      {
        label: "Ensaios",
        value: "Erro de indicação, repetibilidade, excentricidade",
      },
      {
        label: "Incerteza",
        value: "Composta conforme o JCGM 100:2008 (GUM), expandida com k=2",
      },
      {
        label: "Referências de método",
        value:
          "Orientação alinhada a OIML R 76 / EURAMET cg-18 — o laboratório é dono do método",
      },
    ],
    faq: [
      {
        q: "Quais componentes de incerteza o sistema considera na calibração de balança?",
        a: "Os que o laboratório mede e cadastra: repetibilidade (Tipo A), resolução/mostrador, excentricidade, erro de indicação/linearidade, a incerteza do peso-padrão e sua deriva, além do empuxo do ar quando aplicável. As contribuições são compostas quadraticamente e expandidas com o fator k para a incerteza expandida — nada é fixado por padrão.",
      },
      {
        q: "Preciso usar um método de calibração específico?",
        a: "Não. O CalibraFácil é agnóstico ao método: o laboratório define os pontos de calibração, o número de repetições e os ensaios conforme o próprio procedimento (usualmente alinhado a OIML R 76 ou ao guia EURAMET cg-18 para instrumentos de pesagem não automáticos). O sistema garante o registro, o cálculo e a rastreabilidade.",
      },
      {
        q: "O certificado de calibração de balança já sai assinado?",
        a: "Sim. Na aprovação, o PDF é congelado e assinado com o certificado ICP-Brasil A1 do responsável técnico, no padrão PAdES com carimbo de tempo (RFC-3161) e cadeia validada até a AC-Raiz. Qualquer alteração posterior quebra a validação.",
      },
    ],
    related: [
      { label: "Calibração de termômetro", href: "/calibracao/termometro" },
      { label: "Calibração de manômetro", href: "/calibracao/manometro" },
      { label: "Calibração de paquímetro", href: "/calibracao/paquimetro" },
      {
        label: "Cálculo de incerteza conforme o GUM",
        href: "/recursos/calculo-de-incerteza-gum",
      },
    ],
  },
  {
    slug: "termometro",
    metaTitle: "Software para calibração de termômetro (temperatura)",
    description:
      "Sistema para laboratórios que calibram termômetros e sensores de temperatura: calibração por comparação, pontos na faixa, orçamento de incerteza conforme o GUM e certificado assinado em ICP-Brasil.",
    heading: "Calibração de termômetro",
    intro:
      "Para o laboratório que calibra termômetros e sensores de temperatura: o CalibraFácil conduz a calibração por comparação — do registro das indicações em cada ponto ao certificado assinado — com o orçamento de incerteza montado conforme o GUM.",
    body: [
      "A calibração de um termômetro compara a indicação do instrumento contra um termômetro padrão, em pontos ao longo da faixa, dentro de um meio estável — banho termostático, forno de bloco seco ou ponto fixo. A incerteza depende tanto do padrão quanto da estabilidade e da homogeneidade do meio no momento da leitura.",
      "O CalibraFácil registra cada ponto, o padrão utilizado e as condições, e compõe a incerteza a partir dos componentes que o laboratório mede. O certificado sai do modelo Excel do próprio laboratório, congelado e assinado na aprovação.",
    ],
    method: [
      {
        title: "Preparação e estabilização",
        body: "Meio de calibração (banho, bloco seco ou ponto fixo) e estabilização térmica registrados com a calibração.",
      },
      {
        title: "Pontos na faixa",
        body: "O laboratório define os pontos de temperatura; o sistema registra a indicação do instrumento e do padrão em cada um.",
      },
      {
        title: "Comparação com o padrão",
        body: "Cada ponto compara a indicação contra o termômetro padrão, com o erro rastreável ao certificado do padrão.",
      },
      {
        title: "Repetibilidade e estabilidade",
        body: "Repetições e a estabilidade/homogeneidade do meio entram no orçamento como componentes da incerteza.",
      },
      {
        title: "Orçamento de incerteza (GUM)",
        body: "Padrão, repetibilidade, estabilidade do meio, resolução e deriva compostos até a incerteza expandida (k=2).",
      },
      {
        title: "Certificado assinado",
        body: "A aprovação congela o PDF e o assina em ICP-Brasil (PAdES A1, carimbo de tempo). A versão aprovada não muda.",
      },
    ],
    points: [
      {
        title: "Calibração por comparação",
        body: "Registro do padrão e do instrumento em cada ponto, com o erro e a incerteza ligados à evidência.",
      },
      {
        title: "Padrões rastreáveis",
        body: "Termômetro padrão (PRT/Pt-100) e o meio de calibração cadastrados com certificado e validade controlados.",
      },
      {
        title: "Portal do cliente",
        body: "O cliente baixa o certificado, confere a validade e recebe aviso antes do vencimento.",
      },
      {
        title: "Vencimentos e recall",
        body: "Intervalo por instrumento e alerta automático antes do vencimento.",
      },
    ],
    spec: [
      { label: "Grandeza", value: "Temperatura" },
      {
        label: "Faixa típica",
        value:
          "De temperaturas negativas a fornos de alta temperatura, conforme o meio",
      },
      {
        label: "Padrões de referência",
        value:
          "Termômetro padrão (PRT/Pt-100) + banho, bloco seco ou ponto fixo, rastreáveis à RBC",
      },
      {
        label: "Ensaios",
        value:
          "Comparação em pontos, repetibilidade, estabilidade e homogeneidade do meio",
      },
      {
        label: "Incerteza",
        value: "Composta conforme o JCGM 100:2008 (GUM), expandida com k=2",
      },
      {
        label: "Referências de método",
        value:
          "Orientação alinhada aos guias EURAMET de temperatura — o laboratório é dono do método",
      },
    ],
    faq: [
      {
        q: "A calibração de termômetro é feita por comparação?",
        a: "Na maioria dos casos, sim: o instrumento é comparado a um termômetro padrão dentro de um meio estável (banho, bloco seco ou ponto fixo) em cada ponto da faixa. O CalibraFácil registra o padrão, a indicação e as condições, e liga cada ponto à evidência. Pontos fixos definidos pela ITS-90 também podem ser cadastrados como referência do laboratório.",
      },
      {
        q: "Quais fontes de incerteza entram no orçamento?",
        a: "As que o laboratório mede: a incerteza do termômetro padrão, a repetibilidade, a estabilidade e a homogeneidade do meio de calibração, a resolução do indicador e a deriva. As contribuições são compostas conforme o GUM e expandidas com o fator k — nada é fixado por padrão.",
      },
      {
        q: "O certificado já sai assinado?",
        a: "Sim. Na aprovação, o PDF é congelado e assinado com o certificado ICP-Brasil A1 do responsável técnico, em PAdES com carimbo de tempo (RFC-3161) e cadeia até a AC-Raiz.",
      },
    ],
    related: [
      { label: "Calibração de balança", href: "/calibracao/balanca" },
      { label: "Calibração de manômetro", href: "/calibracao/manometro" },
      { label: "Calibração de paquímetro", href: "/calibracao/paquimetro" },
      {
        label: "Cálculo de incerteza conforme o GUM",
        href: "/recursos/calculo-de-incerteza-gum",
      },
    ],
  },
  {
    slug: "manometro",
    metaTitle: "Software para calibração de manômetro (pressão)",
    description:
      "Sistema para laboratórios que calibram manômetros e instrumentos de pressão: pontos ascendentes e descendentes, histerese, orçamento de incerteza conforme o GUM e certificado assinado em ICP-Brasil.",
    heading: "Calibração de manômetro",
    intro:
      "Para o laboratório que calibra manômetros e transdutores de pressão: o CalibraFácil conduz a calibração por comparação contra o padrão — com pontos ascendentes e descendentes para capturar a histerese — e o orçamento de incerteza conforme o GUM.",
    body: [
      "A calibração de um manômetro compara a indicação do instrumento contra um padrão de pressão — balança de pressão (peso morto) ou padrão digital — em pontos ao longo da faixa, medidos na subida e na descida para revelar a histerese. A incerteza reúne o padrão, a resolução, a repetibilidade e a própria histerese.",
      "O CalibraFácil registra cada ponto e sentido, o padrão utilizado e as condições, e compõe a incerteza a partir dos componentes medidos. O certificado sai do modelo do próprio laboratório, congelado e assinado na aprovação.",
    ],
    method: [
      {
        title: "Preparação",
        body: "Meio (pneumático ou hidráulico), posição e condições registrados com a calibração.",
      },
      {
        title: "Pontos na faixa",
        body: "O laboratório define os pontos do zero ao fundo de escala; o sistema registra a indicação e o erro em cada um.",
      },
      {
        title: "Subida e descida (histerese)",
        body: "Cada ponto é medido no sentido ascendente e descendente; a diferença entra no orçamento como componente.",
      },
      {
        title: "Repetibilidade",
        body: "Repetições nos pontos; o desvio entra como contribuição Tipo A ligada à medição.",
      },
      {
        title: "Orçamento de incerteza (GUM)",
        body: "Padrão, resolução, histerese, repetibilidade e deriva compostos até a incerteza expandida (k=2).",
      },
      {
        title: "Certificado assinado",
        body: "A aprovação congela o PDF e o assina em ICP-Brasil (PAdES A1, carimbo de tempo).",
      },
    ],
    points: [
      {
        title: "Histerese registrada",
        body: "Pontos ascendentes e descendentes capturados e refletidos no orçamento de incerteza.",
      },
      {
        title: "Padrões rastreáveis",
        body: "Balança de pressão ou padrão digital cadastrado com certificado e validade controlados.",
      },
      {
        title: "Portal do cliente",
        body: "O cliente baixa o certificado, confere a validade e recebe aviso antes do vencimento.",
      },
      {
        title: "Vencimentos e recall",
        body: "Intervalo por instrumento e alerta automático antes do vencimento.",
      },
    ],
    spec: [
      { label: "Grandeza", value: "Pressão" },
      {
        label: "Faixa típica",
        value: "De baixa pressão a alta pressão, conforme o padrão e o meio",
      },
      {
        label: "Padrões de referência",
        value:
          "Balança de pressão (peso morto) ou padrão digital de pressão, rastreáveis à RBC",
      },
      {
        label: "Ensaios",
        value:
          "Erro de indicação em pontos ascendentes e descendentes, histerese, repetibilidade",
      },
      {
        label: "Incerteza",
        value: "Composta conforme o JCGM 100:2008 (GUM), expandida com k=2",
      },
      {
        label: "Referências de método",
        value:
          "Orientação alinhada aos guias EURAMET de pressão — o laboratório é dono do método",
      },
    ],
    faq: [
      {
        q: "A calibração de manômetro captura a histerese?",
        a: "Sim, quando o método do laboratório prevê. O CalibraFácil registra cada ponto no sentido ascendente e descendente, de modo que a diferença (histerese) fica evidente e entra no orçamento de incerteza. O laboratório define os pontos e o número de ciclos.",
      },
      {
        q: "Que padrão é usado como referência?",
        a: "O padrão que o laboratório cadastra — tipicamente uma balança de pressão (dead-weight tester) ou um padrão digital de pressão de classe adequada, rastreável à RBC. O valor e a incerteza do padrão entram no orçamento e o vencimento é controlado.",
      },
      {
        q: "O certificado já sai assinado?",
        a: "Sim. Na aprovação, o PDF é congelado e assinado com o certificado ICP-Brasil A1 do responsável técnico, em PAdES com carimbo de tempo (RFC-3161) e cadeia até a AC-Raiz.",
      },
    ],
    related: [
      { label: "Calibração de balança", href: "/calibracao/balanca" },
      { label: "Calibração de termômetro", href: "/calibracao/termometro" },
      { label: "Calibração de paquímetro", href: "/calibracao/paquimetro" },
      {
        label: "Certificados ISO/IEC 17025",
        href: "/recursos/certificados-iso-17025",
      },
    ],
  },
  {
    slug: "paquimetro",
    metaTitle: "Software para calibração de paquímetro (dimensional)",
    description:
      "Sistema para laboratórios que calibram paquímetros e instrumentos dimensionais: erro de indicação com blocos-padrão, repetibilidade, orçamento de incerteza conforme o GUM e certificado assinado em ICP-Brasil.",
    heading: "Calibração de paquímetro",
    intro:
      "Para o laboratório que calibra paquímetros e instrumentos de medição dimensional: o CalibraFácil conduz a calibração com blocos-padrão — do erro de indicação em cada ponto ao certificado assinado — com o orçamento de incerteza conforme o GUM.",
    body: [
      "A calibração de um paquímetro verifica o erro de indicação contra blocos-padrão em pontos ao longo da faixa, nas medições de faces externas, internas e de profundidade, após estabilização térmica a 20 °C. A incerteza reúne o bloco-padrão, a resolução, a repetibilidade, a força de medição e o efeito da temperatura.",
      "O CalibraFácil registra cada ponto e tipo de medição, o bloco-padrão utilizado e as condições, e compõe a incerteza a partir dos componentes medidos. O certificado sai do modelo do próprio laboratório, congelado e assinado na aprovação.",
    ],
    method: [
      {
        title: "Estabilização a 20 °C",
        body: "Limpeza e estabilização térmica na temperatura de referência (20 °C) registradas com a calibração.",
      },
      {
        title: "Pontos na faixa",
        body: "O laboratório define os pontos com blocos-padrão ao longo da faixa; o sistema registra a indicação e o erro.",
      },
      {
        title: "Externas, internas e profundidade",
        body: "Erro de indicação verificado nas diferentes medições do instrumento, cada uma registrada.",
      },
      {
        title: "Repetibilidade",
        body: "Repetições nos pontos; o desvio entra como contribuição Tipo A ligada à medição.",
      },
      {
        title: "Orçamento de incerteza (GUM)",
        body: "Bloco-padrão, resolução, repetibilidade, força de medição e temperatura compostos até a incerteza expandida (k=2).",
      },
      {
        title: "Certificado assinado",
        body: "A aprovação congela o PDF e o assina em ICP-Brasil (PAdES A1, carimbo de tempo).",
      },
    ],
    points: [
      {
        title: "Erro de indicação com blocos-padrão",
        body: "Pontos verificados contra blocos-padrão rastreáveis, com o erro registrado por tipo de medição.",
      },
      {
        title: "Padrões rastreáveis",
        body: "Blocos-padrão cadastrados com certificado e validade controlados; o valor e a incerteza entram no orçamento.",
      },
      {
        title: "Portal do cliente",
        body: "O cliente baixa o certificado, confere a validade e recebe aviso antes do vencimento.",
      },
      {
        title: "Vencimentos e recall",
        body: "Intervalo por instrumento e alerta automático antes do vencimento.",
      },
    ],
    spec: [
      { label: "Grandeza", value: "Dimensional (comprimento)" },
      {
        label: "Faixa típica",
        value: "Paquímetros de 0–150 mm a 0–1000 mm, conforme o instrumento",
      },
      {
        label: "Padrões de referência",
        value: "Blocos-padrão (gauge blocks) rastreáveis à RBC",
      },
      {
        label: "Ensaios",
        value:
          "Erro de indicação (externas, internas, profundidade), repetibilidade",
      },
      {
        label: "Incerteza",
        value:
          "Composta conforme o JCGM 100:2008 (GUM), expandida com k=2, referida a 20 °C",
      },
      {
        label: "Referências de método",
        value:
          "Boas práticas de metrologia dimensional a 20 °C — o laboratório é dono do método",
      },
    ],
    faq: [
      {
        q: "Como o erro de indicação do paquímetro é verificado?",
        a: "Contra blocos-padrão rastreáveis, em pontos ao longo da faixa e nas medições de faces externas, internas e de profundidade, após estabilização térmica a 20 °C. O CalibraFácil registra cada ponto, o bloco usado e o erro, ligando tudo à evidência.",
      },
      {
        q: "A temperatura entra na incerteza?",
        a: "Sim. A metrologia dimensional é referida a 20 °C; o desvio de temperatura e o coeficiente de expansão entram no orçamento de incerteza junto com o bloco-padrão, a resolução, a repetibilidade e a força de medição — todos compostos conforme o GUM.",
      },
      {
        q: "O certificado já sai assinado?",
        a: "Sim. Na aprovação, o PDF é congelado e assinado com o certificado ICP-Brasil A1 do responsável técnico, em PAdES com carimbo de tempo (RFC-3161) e cadeia até a AC-Raiz.",
      },
    ],
    related: [
      { label: "Calibração de balança", href: "/calibracao/balanca" },
      { label: "Calibração de termômetro", href: "/calibracao/termometro" },
      { label: "Calibração de manômetro", href: "/calibracao/manometro" },
      {
        label: "Cálculo de incerteza conforme o GUM",
        href: "/recursos/calculo-de-incerteza-gum",
      },
    ],
  },
];

export function getGrandeza(slug: string): Grandeza | undefined {
  return GRANDEZAS.find((grandeza) => grandeza.slug === slug);
}
