// Public URLs of the documentation and the project site. Forks that host their
// own copy override them at build time.
export const site = {
  name: "CalibraFácil",
  docsName: "Documentação CalibraFácil",
  productUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://calibrafacil.com",
  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL ?? "https://calibrafacil.com/docs",
  repositoryUrl: "https://github.com/CalibraFacil/calibrafacil",
  description:
    "Documentação do CalibraFácil, software de código aberto para laboratórios de calibração — GUM, certificados ISO/IEC 17025.",
  locale: "pt-BR",
};
