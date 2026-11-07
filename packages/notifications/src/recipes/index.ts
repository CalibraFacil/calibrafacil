import type { NotificationRecipes } from "./types";
import { calibrationRequestRecipes } from "./calibration-request";
import { competenceRecipes } from "./competence";
import { complianceRecipes } from "./compliance";
import { jobRecipes } from "./job";
import { ncRecipes } from "./nc";
import { portalRecipes } from "./portal";
import { visitRecipes } from "./visit";

/**
 * Every notification type and how it is delivered. Typed as the full
 * `NotificationRecipes`, so a type added to the registry without a recipe here
 * (in one of the domain files) does not compile.
 */
export const NOTIFICATION_RECIPES: NotificationRecipes = {
  ...calibrationRequestRecipes,
  ...competenceRecipes,
  ...complianceRecipes,
  ...jobRecipes,
  ...ncRecipes,
  ...portalRecipes,
  ...visitRecipes,
};

export type { NotificationPayloads, NotificationRecipes } from "./types";
