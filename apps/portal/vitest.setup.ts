import { configure } from "@testing-library/react";

// A busy CI runner can take longer than Testing Library's 1 s default to
// settle a page that renders after its queries resolve: the asset page's
// interval suggestion timed out there twice. Waiting longer costs nothing
// when a test passes, so findBy* and waitFor get 5 s.
configure({ asyncUtilTimeout: 5_000 });
