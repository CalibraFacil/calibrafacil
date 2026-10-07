import type { SeedApi } from "./api";
import type { Rng } from "./prng";

/** Everything a seed step needs; steps stay free of module-level state. */
export type SeedContext = {
  api: SeedApi;
  rng: Rng;
  /** The moment the seed started; every relative date derives from it. */
  now: Date;
  log: (message: string) => void;
};

/** Ids produced by earlier steps, handed to later ones. */
export type SeedRefs = {
  unitId: number;
  /** asset_type.id by slug. */
  assetTypeIds: Map<string, number>;
};
