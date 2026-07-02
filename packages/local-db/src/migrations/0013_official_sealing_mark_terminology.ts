// Official Inmetro terminology (marca de selagem / marca de reparo).
// Mirrors cloud migration 0076: rename the seal columns to the normative
// vocabulary and drop the orphaned repaired_seal_number column.
export const migration0013OfficialSealingMarkTerminology = {
  id: 13,
  name: "official_sealing_mark_terminology",
  sql: `
ALTER TABLE service_orders RENAME COLUMN old_seal_number TO removed_sealing_mark_number;
ALTER TABLE service_orders RENAME COLUMN new_seal_number TO affixed_sealing_mark_number;
ALTER TABLE service_orders RENAME COLUMN inmetro_repair_seal_number TO inmetro_repair_mark_number;
ALTER TABLE service_orders DROP COLUMN repaired_seal_number;
`,
};
