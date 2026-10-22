import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Same budget as the apps: a loaded CI runner can take longer than Testing
// Library's 1 s default to settle an async render.
configure({ asyncUtilTimeout: 5_000 });

// Vitest runs without globals, so Testing Library cannot register its own
// automatic cleanup: unmount between tests ourselves.
afterEach(cleanup);
