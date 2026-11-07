import {
  Add01Icon,
  Alert02Icon,
  Analytics01Icon,
  Calendar03Icon,
  File01Icon,
  Home01Icon,
  Notebook01Icon,
  Notification01Icon,
  PaintBoardIcon,
  ToolsIcon,
  UserIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

import type { PortalIconId } from "@/lib/route-registry";

/** The glyph of each icon id of the route registry (which stays free of component imports). */
export const PORTAL_ICONS = {
  add: Add01Icon,
  appearance: PaintBoardIcon,
  assets: Wrench01Icon,
  calendar: Calendar03Icon,
  certificates: File01Icon,
  home: Home01Icon,
  notifications: Notification01Icon,
  outOfTolerance: Alert02Icon,
  profile: UserIcon,
  reliability: Analytics01Icon,
  requests: Notebook01Icon,
  serviceOrders: ToolsIcon,
} as const satisfies Record<PortalIconId, IconSvgElement>;
