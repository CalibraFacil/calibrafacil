import { Callout } from "fumadocs-ui/components/callout";
import type { ReactNode } from "react";

type AsideType = "note" | "tip" | "caution" | "danger";

const TYPE_MAP: Record<AsideType, "info" | "warn" | "error" | "success"> = {
  note: "info",
  tip: "success",
  caution: "warn",
  danger: "error",
};

export function Aside({
  type = "note",
  title,
  children,
}: {
  type?: AsideType;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <Callout type={TYPE_MAP[type]} title={title}>
      {children}
    </Callout>
  );
}
