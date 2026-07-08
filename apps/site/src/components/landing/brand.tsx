import { cn } from "@/lib/utils";

export function BrandLockup({
  markClassName,
  textClassName,
}: {
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn("relative inline-flex size-8 shrink-0", markClassName)}
      >
        <img
          src="/logo-mark-light.svg"
          alt=""
          aria-hidden
          className="size-full dark:hidden"
          draggable={false}
        />
        <img
          src="/logo-mark-dark.svg"
          alt=""
          aria-hidden
          className="hidden size-full dark:block"
          draggable={false}
        />
      </span>
      <span
        className={cn("text-lg font-semibold tracking-tight", textClassName)}
      >
        CalibraFácil
      </span>
    </div>
  );
}
