import { afterAll, beforeEach, vi } from "vitest";

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// Clean up after all tests
afterAll(() => {
  vi.restoreAllMocks();
});
