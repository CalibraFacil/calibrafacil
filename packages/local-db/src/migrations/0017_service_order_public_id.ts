// The lab dashboard routes service orders by the cloud's opaque `publicId`
// instead of the enumerable serial id. Mirroring it locally means a synced OS
// has the SAME url in both runtimes; an order created offline still has none
// (publicId is assigned by the cloud) and keeps resolving by its local id,
// which is already opaque.
export const migration0017ServiceOrderPublicId = {
  id: 17,
  name: "service_order_public_id",
  sql: `
ALTER TABLE service_orders ADD COLUMN public_id TEXT;
CREATE INDEX IF NOT EXISTS idx_service_orders_public_id
  ON service_orders (public_id);
`,
};
