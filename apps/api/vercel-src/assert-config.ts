import { loadApiConfig } from "@calibra-facil/config";

// Imported FIRST by every Vercel function entry (index, queue consumer, cron),
// so the configuration is validated when the function cold-starts, before the
// application graph loads: a bad deploy fails here with one error that lists
// every problem, not at first use deep inside a request.
loadApiConfig();
