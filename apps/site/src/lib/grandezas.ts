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
  {
    slug: "torquimetro",
    metaTitle: "Software para calibração de torquímetro (torque)",
    description:
      "Sistema para laboratórios que calibram torquímetros: pontos na faixa, sentido horário e anti-horário, repetibilidade, orçamento de incerteza conforme o GUM e certificado assinado em ICP-Brasil.",
    heading: "Calibração de torquímetro",
    intro:
      "Para o laboratório que calibra torquímetros e ferramentas de aperto: o CalibraFácil conduz a calibração contra o padrão de torque — do registro dos pontos ao certificado assinado — com o orçamento de incerteza montado conforme o GUM.",
    body: [
      "A calibração de um torquímetro compara o torque aplicado ou indicado pelo instrumento contra um padrão de torque, em pontos ao longo da faixa e, quando o instrumento exige, nos dois sentidos de aplicação. A incerteza reúne o padrão, a resolução, a repetibilidade e a reprodutibilidade entre montagens.",
      "O CalibraFácil registra cada ponto, sentido e o padrão utilizado, e compõe a incerteza a partir dos componentes medidos. O certificado sai do modelo Excel do próprio laboratório, congelado e assinado na aprovação — e, para ferramentas de aperto, a conformidade com a classe pode ser declarada.",
    ],
    method: [
      {
        title: "Preparação",
        body: "Montagem, pré-carregamento e estabilização registrados com a calibração, conforme o procedimento do laboratório.",
      },
      {
        title: "Pontos na faixa",
        body: "O laboratório define os pontos de torque; o sistema registra a indicação e o erro em cada um.",
      },
      {
        title: "Horário e anti-horário",
        body: "Quando o instrumento opera nos dois sentidos, cada sentido é registrado separadamente.",
      },
      {
        title: "Repetibilidade e reprodutibilidade",
        body: "Repetições e o efeito da remontagem entram no orçamento como componentes da incerteza.",
      },
      {
        title: "Orçamento de incerteza (GUM)",
        body: "Padrão, resolução, repetibilidade, reprodutibilidade e deriva compostos até a incerteza expandida (k=2).",
      },
      {
        title: "Certificado assinado",
        body: "A aprovação congela o PDF e o assina em ICP-Brasil (PAdES A1, carimbo de tempo).",
      },
    ],
    points: [
      {
        title: "Dois sentidos e classe",
        body: "Registro por sentido de aplicação e, para ferramentas, declaração de conformidade com a classe da ISO 6789.",
      },
      {
        title: "Padrões rastreáveis",
        body: "Transdutor ou máquina de torque padrão cadastrado com certificado e validade controlados.",
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
      { label: "Grandeza", value: "Torque" },
      {
        label: "Faixa típica",
        value: "De poucos N·cm a centenas de N·m, conforme o padrão",
      },
      {
        label: "Padrões de referência",
        value:
          "Transdutor de torque ou máquina de calibração de torque, rastreáveis à RBC",
      },
      {
        label: "Ensaios",
        value:
          "Erro de indicação em pontos, sentido horário/anti-horário, repetibilidade, reprodutibilidade",
      },
      {
        label: "Incerteza",
        value: "Composta conforme o JCGM 100:2008 (GUM), expandida com k=2",
      },
      {
        label: "Referências de método",
        value:
          "ISO 6789 (ferramentas de aperto) / guias EURAMET de torque — o laboratório é dono do método",
      },
    ],
    faq: [
      {
        q: "Dá para calibrar chaves de torque (torquímetros de estalo) e declarar a classe?",
        a: "Sim. O laboratório executa os pontos conforme a ISO 6789 para o tipo de ferramenta, e o CalibraFácil registra os resultados e permite declarar a conformidade com a classe. Para torquímetros indicadores, o registro é do erro de indicação por ponto, com a incerteza associada.",
      },
      {
        q: "O sentido de aplicação é registrado?",
        a: "Sim. Quando o instrumento opera no sentido horário e anti-horário, cada sentido é registrado separadamente, porque o erro e a repetibilidade podem diferir entre eles.",
      },
      {
        q: "O certificado já sai assinado?",
        a: "Sim. Na aprovação, o PDF é congelado e assinado com o certificado ICP-Brasil A1 do responsável técnico, em PAdES com carimbo de tempo (RFC-3161) e cadeia até a AC-Raiz.",
      },
    ],
    related: [
      { label: "Calibração de manômetro", href: "/calibracao/manometro" },
      { label: "Calibração de micrômetro", href: "/calibracao/micrometro" },
      { label: "Calibração de balança", href: "/calibracao/balanca" },
      {
        label: "Cálculo de incerteza conforme o GUM",
        href: "/recursos/calculo-de-incerteza-gum",
      },
    ],
  },
  {
    slug: "micrometro",
    metaTitle: "Software para calibração de micrômetro (dimensional)",
    description:
      "Sistema para laboratórios que calibram micrômetros: erro de indicação com blocos-padrão, planeza e paralelismo das faces, repetibilidade, orçamento de incerteza conforme o GUM e certificado assinado em ICP-Brasil.",
    heading: "Calibração de micrômetro",
    intro:
      "Para o laboratório que calibra micrômetros externos, internos e de profundidade: o CalibraFácil conduz a calibração com blocos-padrão — do erro de indicação ao certificado assinado — com o orçamento de incerteza conforme o GUM.",
    body: [
      "A calibração de um micrômetro verifica o erro de indicação contra blocos-padrão em pontos ao longo da faixa, após estabilização térmica a 20 °C, e avalia a planeza e o paralelismo das faces de medição com planos ópticos. A incerteza reúne o bloco-padrão, a resolução, a repetibilidade, a força de medição e o efeito da temperatura.",
      "O CalibraFácil registra cada ponto, o bloco-padrão utilizado e as condições, e compõe a incerteza a partir dos componentes medidos. O certificado sai do modelo do próprio laboratório, congelado e assinado na aprovação.",
    ],
    method: [
      {
        title: "Estabilização a 20 °C",
        body: "Limpeza e estabilização térmica na temperatura de referência (20 °C) registradas com a calibração.",
      },
      {
        title: "Erro de indicação",
        body: "Pontos com blocos-padrão ao longo da faixa; o sistema registra a indicação e o erro em cada um.",
      },
      {
        title: "Planeza e paralelismo",
        body: "Avaliação das faces de medição com planos ópticos (franjas de interferência), registrada com a calibração.",
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
        title: "Faces avaliadas",
        body: "Planeza e paralelismo das faces registrados com planos ópticos, além do erro de indicação.",
      },
      {
        title: "Padrões rastreáveis",
        body: "Blocos-padrão e planos ópticos cadastrados com certificado e validade controlados.",
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
        value: "Micrômetros de 0–25 mm em diante, por faixa de 25 mm",
      },
      {
        label: "Padrões de referência",
        value: "Blocos-padrão e planos ópticos, rastreáveis à RBC",
      },
      {
        label: "Ensaios",
        value: "Erro de indicação, planeza e paralelismo das faces, repetibilidade",
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
        q: "A calibração de micrômetro avalia as faces de medição?",
        a: "Sim. Além do erro de indicação contra blocos-padrão, a planeza e o paralelismo das faces são avaliados com planos ópticos (pela contagem de franjas de interferência) e registrados. Esses desvios afetam a medição e podem entrar na avaliação do instrumento.",
      },
      {
        q: "Por que a temperatura importa?",
        a: "A metrologia dimensional é referida a 20 °C. O desvio de temperatura e o coeficiente de expansão entram no orçamento de incerteza junto com o bloco-padrão, a resolução, a repetibilidade e a força de medição — todos compostos conforme o GUM.",
      },
      {
        q: "O certificado já sai assinado?",
        a: "Sim. Na aprovação, o PDF é congelado e assinado com o certificado ICP-Brasil A1 do responsável técnico, em PAdES com carimbo de tempo (RFC-3161) e cadeia até a AC-Raiz.",
      },
    ],
    related: [
      { label: "Calibração de paquímetro", href: "/calibracao/paquimetro" },
      { label: "Calibração de torquímetro", href: "/calibracao/torquimetro" },
      { label: "Calibração de balança", href: "/calibracao/balanca" },
      {
        label: "Cálculo de incerteza conforme o GUM",
        href: "/recursos/calculo-de-incerteza-gum",
      },
    ],
  },
  {
    slug: "multimetro",
    metaTitle: "Software para calibração de multímetro (grandezas elétricas)",
    description:
      "Sistema para laboratórios que calibram multímetros e instrumentos elétricos: tensão CC/CA, corrente e resistência em pontos, orçamento de incerteza conforme o GUM e certificado assinado em ICP-Brasil.",
    heading: "Calibração de multímetro",
    intro:
      "Para o laboratório que calibra multímetros e instrumentos de grandezas elétricas: o CalibraFácil conduz a calibração contra o calibrador padrão — do registro dos pontos por função ao certificado assinado — com o orçamento de incerteza conforme o GUM.",
    body: [
      "A calibração de um multímetro compara a indicação do instrumento contra um calibrador multifunção padrão, em pontos por função — tensão contínua e alternada, corrente e resistência. A incerteza reúne o calibrador, a resolução, a repetibilidade, a deriva e, na CA, a dependência de frequência.",
      "O CalibraFácil registra cada ponto, função e o padrão utilizado, e compõe a incerteza a partir dos componentes medidos. O certificado sai do modelo do próprio laboratório, congelado e assinado na aprovação.",
    ],
    method: [
      {
        title: "Preparação",
        body: "Aquecimento do instrumento e do padrão e condições ambientais registrados com a calibração.",
      },
      {
        title: "Pontos por função",
        body: "O laboratório define os pontos em cada função (VCC, VCA, corrente, resistência); o sistema registra a indicação e o erro.",
      },
      {
        title: "Comparação com o padrão",
        body: "Cada ponto compara a indicação contra o calibrador padrão, com o erro rastreável ao certificado do padrão.",
      },
      {
        title: "Repetibilidade",
        body: "Repetições nos pontos; o desvio entra como contribuição Tipo A ligada à medição.",
      },
      {
        title: "Orçamento de incerteza (GUM)",
        body: "Calibrador, resolução, repetibilidade, deriva e dependência de frequência compostos até a incerteza expandida (k=2).",
      },
      {
        title: "Certificado assinado",
        body: "A aprovação congela o PDF e o assina em ICP-Brasil (PAdES A1, carimbo de tempo).",
      },
    ],
    points: [
      {
        title: "Todas as funções",
        body: "Tensão CC/CA, corrente e resistência em pontos, cada função com seu erro e incerteza.",
      },
      {
        title: "Padrões rastreáveis",
        body: "Calibrador multifunção padrão cadastrado com certificado e validade controlados.",
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
      { label: "Grandeza", value: "Grandezas elétricas (tensão, corrente, resistência)" },
      {
        label: "Faixa típica",
        value: "De mV a kV, de µA a A e de Ω a MΩ, conforme o calibrador",
      },
      {
        label: "Padrões de referência",
        value: "Calibrador multifunção / multiproduto padrão, rastreável à RBC",
      },
      {
        label: "Ensaios",
        value:
          "Erro de indicação por função (VCC, VCA, corrente, resistência), repetibilidade",
      },
      {
        label: "Incerteza",
        value: "Composta conforme o JCGM 100:2008 (GUM), expandida com k=2",
      },
      {
        label: "Referências de método",
        value:
          "Guias EURAMET de instrumentação elétrica — o laboratório é dono do método",
      },
    ],
    faq: [
      {
        q: "O sistema cobre todas as funções do multímetro?",
        a: "Sim. O laboratório define os pontos em cada função — tensão contínua e alternada, corrente e resistência — e o CalibraFácil registra o erro de indicação e a incerteza por ponto, cada um ligado ao padrão utilizado.",
      },
      {
        q: "A frequência entra na incerteza da tensão alternada?",
        a: "Quando o método do laboratório considera, sim: a dependência de frequência do instrumento e do calibrador pode entrar no orçamento de incerteza das funções de corrente alternada, junto com o calibrador, a resolução, a repetibilidade e a deriva — todos compostos conforme o GUM.",
      },
      {
        q: "O certificado já sai assinado?",
        a: "Sim. Na aprovação, o PDF é congelado e assinado com o certificado ICP-Brasil A1 do responsável técnico, em PAdES com carimbo de tempo (RFC-3161) e cadeia até a AC-Raiz.",
      },
    ],
    related: [
      { label: "Calibração de termo-higrômetro", href: "/calibracao/termo-higrometro" },
      { label: "Calibração de manômetro", href: "/calibracao/manometro" },
      { label: "Calibração de balança", href: "/calibracao/balanca" },
      {
        label: "Cálculo de incerteza conforme o GUM",
        href: "/recursos/calculo-de-incerteza-gum",
      },
    ],
  },
  {
    slug: "termo-higrometro",
    metaTitle: "Software para calibração de termo-higrômetro (umidade)",
    description:
      "Sistema para laboratórios que calibram termo-higrômetros: pontos de umidade e temperatura em câmara, comparação, orçamento de incerteza conforme o GUM e certificado assinado em ICP-Brasil.",
    heading: "Calibração de termo-higrômetro",
    intro:
      "Para o laboratório que calibra termo-higrômetros e sensores de umidade: o CalibraFácil conduz a calibração por comparação em câmara ou gerador de umidade — do registro dos pontos ao certificado assinado — com o orçamento de incerteza conforme o GUM.",
    body: [
      "A calibração de um termo-higrômetro compara a indicação de umidade relativa (e de temperatura) do instrumento contra um higrômetro padrão, em pontos dentro de um gerador ou câmara climática estável. A incerteza depende do padrão e, de forma marcante, da estabilidade e da homogeneidade da câmara no momento da leitura.",
      "O CalibraFácil registra cada ponto de umidade e temperatura, o padrão utilizado e as condições, e compõe a incerteza a partir dos componentes medidos. O certificado sai do modelo do próprio laboratório, congelado e assinado na aprovação.",
    ],
    method: [
      {
        title: "Preparação e estabilização",
        body: "Câmara ou gerador de umidade e estabilização registrados com a calibração.",
      },
      {
        title: "Pontos de umidade e temperatura",
        body: "O laboratório define os pontos de UR (e temperatura); o sistema registra a indicação do instrumento e do padrão.",
      },
      {
        title: "Comparação com o padrão",
        body: "Cada ponto compara a indicação contra o higrômetro padrão, com o erro rastreável ao certificado do padrão.",
      },
      {
        title: "Estabilidade e homogeneidade",
        body: "A estabilidade e a homogeneidade da câmara entram no orçamento como componentes da incerteza.",
      },
      {
        title: "Orçamento de incerteza (GUM)",
        body: "Padrão, estabilidade e homogeneidade da câmara, repetibilidade, resolução e histerese compostos até a incerteza expandida (k=2).",
      },
      {
        title: "Certificado assinado",
        body: "A aprovação congela o PDF e o assina em ICP-Brasil (PAdES A1, carimbo de tempo).",
      },
    ],
    points: [
      {
        title: "Umidade e temperatura juntas",
        body: "Registro de UR e temperatura em cada ponto, cada grandeza com seu erro e incerteza.",
      },
      {
        title: "Padrões rastreáveis",
        body: "Higrômetro padrão e o gerador/câmara de umidade cadastrados com certificado e validade controlados.",
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
      { label: "Grandeza", value: "Umidade relativa (e temperatura)" },
      {
        label: "Faixa típica",
        value: "Faixa de umidade relativa da câmara, em temperaturas definidas",
      },
      {
        label: "Padrões de referência",
        value:
          "Higrômetro padrão + gerador ou câmara de umidade, rastreáveis à RBC",
      },
      {
        label: "Ensaios",
        value:
          "Comparação em pontos, repetibilidade, estabilidade e homogeneidade da câmara",
      },
      {
        label: "Incerteza",
        value: "Composta conforme o JCGM 100:2008 (GUM), expandida com k=2",
      },
      {
        label: "Referências de método",
        value:
          "Guias EURAMET de umidade — o laboratório é dono do método",
      },
    ],
    faq: [
      {
        q: "A calibração cobre umidade e temperatura no mesmo certificado?",
        a: "Sim. Como o termo-higrômetro indica as duas grandezas, o laboratório registra os pontos de umidade relativa e de temperatura, cada um com seu erro e sua incerteza, e o CalibraFácil emite o certificado com ambos.",
      },
      {
        q: "Por que a câmara pesa tanto na incerteza?",
        a: "Porque a umidade dentro do volume varia no tempo e no espaço. A estabilidade e a homogeneidade da câmara no momento da leitura entram no orçamento de incerteza junto com o padrão, a repetibilidade, a resolução e a histerese — todos compostos conforme o GUM.",
      },
      {
        q: "O certificado já sai assinado?",
        a: "Sim. Na aprovação, o PDF é congelado e assinado com o certificado ICP-Brasil A1 do responsável técnico, em PAdES com carimbo de tempo (RFC-3161) e cadeia até a AC-Raiz.",
      },
    ],
    related: [
      { label: "Calibração de termômetro", href: "/calibracao/termometro" },
      { label: "Calibração de multímetro", href: "/calibracao/multimetro" },
      { label: "Calibração de balança", href: "/calibracao/balanca" },
      {
        label: "Cálculo de incerteza conforme o GUM",
        href: "/recursos/calculo-de-incerteza-gum",
      },
    ],
  },
  {
    slug: "pipeta",
    metaTitle: "Software para calibração de pipeta (volume, método gravimétrico)",
    description:
      "Sistema para laboratórios que calibram pipetas e micropipetas: método gravimétrico conforme a ISO 8655, erro sistemático e repetibilidade, orçamento de incerteza conforme o GUM e certificado assinado em ICP-Brasil.",
    heading: "Calibração de pipeta",
    intro:
      "Para o laboratório que calibra pipetas e micropipetas: o CalibraFácil conduz a calibração gravimétrica — da pesagem da água dispensada ao certificado assinado — com o volume e o orçamento de incerteza montados conforme o GUM.",
    body: [
      "A calibração gravimétrica de uma pipeta pesa a água dispensada numa balança e converte a massa em volume usando a densidade da água e o fator Z, que dependem da temperatura e da pressão. Repetindo as dispensas, o laboratório obtém o erro sistemático e a repetibilidade em cada volume ensaiado.",
      "O CalibraFácil registra as pesagens, as condições ambientais e o padrão (balança, termômetro, barômetro), e compõe a incerteza a partir dos componentes medidos. O certificado sai do modelo do próprio laboratório, congelado e assinado na aprovação.",
    ],
    method: [
      {
        title: "Preparação e ambiente",
        body: "Estabilização, temperatura da água, temperatura ambiente e pressão registradas — entram na conversão massa→volume.",
      },
      {
        title: "Volumes ensaiados",
        body: "O laboratório define os volumes (tipicamente nominal, intermediário e mínimo); o sistema registra cada dispensa.",
      },
      {
        title: "Pesagem gravimétrica",
        body: "Cada dispensa de água é pesada numa balança calibrada e convertida em volume pela densidade e pelo fator Z.",
      },
      {
        title: "Erro e repetibilidade",
        body: "Repetições em cada volume dão o erro sistemático e a repetibilidade, avaliados conforme a ISO 8655.",
      },
      {
        title: "Orçamento de incerteza (GUM)",
        body: "Balança, densidade/temperatura da água, fator Z, repetibilidade e evaporação compostos até a incerteza expandida (k=2).",
      },
      {
        title: "Certificado assinado",
        body: "A aprovação congela o PDF e o assina em ICP-Brasil (PAdES A1, carimbo de tempo).",
      },
    ],
    points: [
      {
        title: "Método gravimétrico (ISO 8655)",
        body: "Pesagem da água convertida em volume, com erro sistemático e repetibilidade por volume ensaiado.",
      },
      {
        title: "Padrões rastreáveis",
        body: "Balança, termômetro e barômetro cadastrados com certificado e validade controlados.",
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
      { label: "Grandeza", value: "Volume" },
      {
        label: "Faixa típica",
        value: "Micropipetas de µL a pipetas de mL, conforme o instrumento",
      },
      {
        label: "Padrões de referência",
        value:
          "Balança calibrada + termômetro e barômetro, rastreáveis à RBC; água de referência",
      },
      {
        label: "Ensaios",
        value: "Erro sistemático e repetibilidade por volume (método gravimétrico)",
      },
      {
        label: "Incerteza",
        value: "Composta conforme o JCGM 100:2008 (GUM), expandida com k=2",
      },
      {
        label: "Referências de método",
        value: "ISO 8655 (aparelhos volumétricos de pistão) — o laboratório é dono do método",
      },
    ],
    faq: [
      {
        q: "A calibração de pipeta é gravimétrica?",
        a: "Na maioria dos laboratórios, sim: pesa-se a água dispensada e converte-se a massa em volume usando a densidade da água e o fator Z, conforme a ISO 8655. O CalibraFácil registra as pesagens, as condições e o padrão, e calcula o erro sistemático e a repetibilidade por volume.",
      },
      {
        q: "O que é o fator Z e por que ele importa?",
        a: "O fator Z converte massa em volume levando em conta a densidade da água e do ar na temperatura e pressão do ensaio, além do empuxo. Ele entra na conversão e no orçamento de incerteza — por isso a temperatura da água, a temperatura ambiente e a pressão são registradas com a calibração.",
      },
      {
        q: "O certificado já sai assinado?",
        a: "Sim. Na aprovação, o PDF é congelado e assinado com o certificado ICP-Brasil A1 do responsável técnico, em PAdES com carimbo de tempo (RFC-3161) e cadeia até a AC-Raiz.",
      },
    ],
    related: [
      { label: "Calibração de balança", href: "/calibracao/balanca" },
      { label: "Calibração de termômetro", href: "/calibracao/termometro" },
      { label: "Calibração de micrômetro", href: "/calibracao/micrometro" },
      {
        label: "Certificados ISO/IEC 17025",
        href: "/recursos/certificados-iso-17025",
      },
    ],
  },
];

export function getGrandeza(slug: string): Grandeza | undefined {
  return GRANDEZAS.find((grandeza) => grandeza.slug === slug);
}
