import app from "../src/index";
import { createApiRuntimeEnv } from "../src/lib/runtime-env";

const handler = (request: Request) => app.fetch(request, createApiRuntimeEnv());

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;

export default {
  fetch: handler,
};
