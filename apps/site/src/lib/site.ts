// Every link the site makes into the project. The repository is the product
// here: the docs, the guides and the community all live on GitHub.
export const REPOSITORY_URL = "https://github.com/CalibraFacil/calibrafacil";

const BLOB_URL = `${REPOSITORY_URL}/blob/main`;

export const README_URL = `${REPOSITORY_URL}#readme`;
export const CONTRIBUTING_URL = `${BLOB_URL}/CONTRIBUTING.md`;
export const DEPLOYMENT_URL = `${BLOB_URL}/DEPLOYMENT.md`;
export const SECURITY_URL = `${BLOB_URL}/SECURITY.md`;
export const LICENSE_URL = `${BLOB_URL}/LICENSE`;
export const DISCUSSIONS_URL = `${REPOSITORY_URL}/discussions`;
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;

// User documentation: the MDX sources of apps/docs.
export const DOCS_URL = `${REPOSITORY_URL}/tree/main/apps/docs/content/docs`;

// Validation dossiers of the uncertainty engine, one per released version.
export const VALIDATION_URL = `${REPOSITORY_URL}/tree/main/validation/math-engine`;

// In-page anchor of the "run it yourself" section.
export const RUN_LOCALLY_URL = "/#rodar";
