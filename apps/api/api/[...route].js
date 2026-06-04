import {
  DELETE,
  GET,
  OPTIONS,
  PATCH,
  POST,
  PUT,
} from "../vercel-functions/[...route].js";

export { DELETE, GET, OPTIONS, PATCH, POST, PUT };

// Vercel's Bun runtime must resolve a directly-declared default export (a
// function or a `{ fetch }` server). A re-exported default
// (`export { default } from …`) is no longer followed by the runtime and fails
// at cold start with "The default export must be a function or server", so the
// fetch server is declared inline here.
export default { fetch: GET };
