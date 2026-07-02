export const migration0012ServiceOrderItemMaterial = {
  id: 12,
  name: "service_order_item_material",
  sql: `
ALTER TABLE service_order_quote_items ADD COLUMN material_id INTEGER;
ALTER TABLE service_order_execution_items ADD COLUMN material_id INTEGER;
`,
};
