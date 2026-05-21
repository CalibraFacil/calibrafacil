import { Toaster as Sonner } from "sonner";

import type { ToasterProps } from "sonner";

type SonnerStyle = React.CSSProperties & {
  "--normal-bg"?: string;
  "--normal-text"?: string;
  "--normal-border"?: string;
};

function Toaster({ ...props }: ToasterProps) {
  const style: SonnerStyle = {
    "--normal-bg": "var(--popover)",
    "--normal-text": "var(--popover-foreground)",
    "--normal-border": "var(--border)",
  };

  return (
    <Sonner
      className="toaster group"
      style={style}
      {...props}
    />
  );
}

export { Toaster };
