import { afterAll, beforeEach, vi } from "vitest";
import { checkEndpointResponses } from "../src/lib/endpoint-response-check";

// A mounted endpoint whose response drifts from its contract schema fails the request.
checkEndpointResponses();

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// Clean up after all tests
afterAll(() => {
  vi.restoreAllMocks();
});
