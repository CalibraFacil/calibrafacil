import { createApiApp } from "./app";

const app = createApiApp();

export type AppType = typeof app;
export default app;
