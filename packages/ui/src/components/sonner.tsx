import { Toaster as Sonner } from "sonner";

import type { ToasterProps } from "sonner";

type SonnerStyle = React.CSSProperties & {
  "--normal-bg"?: string;
  "--normal-text"?: string;
  "--normal-border"?: string;
  "--border-radius"?: string;
};

/**
 * Theme tokens only: the toast surface follows the popover tokens.
 *
 * It deliberately knows neither a theme provider nor an icon set. The lab app
 * owns light/dark switching (next-themes) and passes `theme` and `icons`; the
 * portal leaves both unset, keeping sonner's light default and built-in icons.
 * Importing the icon runtime here would put it in the portal's initial bundle
 * graph, where the toaster is mounted at the root.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const style: SonnerStyle = {
    "--normal-bg": "var(--popover)",
    "--normal-text": "var(--popover-foreground)",
    "--normal-border": "var(--border)",
    "--border-radius": "var(--radius)",
  };

  return <Sonner className="toaster group" style={style} {...props} />;
};

export { Toaster };
