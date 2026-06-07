import {
  DELETE,
  GET,
  OPTIONS,
  PATCH,
  POST,
  PUT,
} from "../vercel-functions/index.js";

export { DELETE, GET, OPTIONS, PATCH, POST, PUT };

// Vercel's Bun runtime validates the default export at cold start and demands a
// directly-declared function or `{ fetch }` server. A re-exported default
// (`export { default } from …`) was never followed; a later Vercel-managed Bun
// patch (we can't pin the version — bunVersion only accepts "1.x") also rejects
// `{ fetch: GET }` where `fetch` is an imported binding ("The default export
// must be a function or server"). Wrap it in a locally-declared function so
// `fetch` is a real function at evaluation time; the imported handler is read
// lazily per request.
export default { fetch: (request) => GET(request) };
