import { cn } from "@/lib/utils";
import { useBranding } from "@/features/branding/branding-context";

type BrandMarkProps = Omit<React.ComponentProps<"img">, "src">;

interface BrandLockupProps extends React.ComponentProps<"div"> {
  markClassName?: string;
  textClassName?: string;
}

// The mark is sized by HEIGHT with auto width, so a lab's white-label logo
// (often wider than tall) fills the available height instead of being shrunk
// into a square box. Callers pass a height class (e.g. `h-12`).
export function BrandMark({ alt, className, ...props }: BrandMarkProps) {
  const branding = useBranding();
  // Preserve an explicitly-empty alt (decorative usage); otherwise default to
  // the resolved brand name.
  const altText = alt ?? branding.name;

  if (branding.logo) {
    return (
      <span
        className={cn(
          "inline-flex h-8 w-auto shrink-0 items-center",
          className,
        )}
      >
        <img
          src={branding.logo}
          alt={altText}
          className="h-full w-auto max-w-[14rem] object-contain"
          draggable={false}
          {...props}
        />
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex h-8 w-auto shrink-0 items-center", className)}
    >
      <img
        src="/logo-mark-light.svg"
        alt={altText}
        className="h-full w-auto object-contain dark:hidden"
        draggable={false}
        {...props}
      />
      <img
        src="/logo-mark-dark.svg"
        alt={altText}
        className="hidden h-full w-auto object-contain dark:block"
        draggable={false}
        {...props}
      />
    </span>
  );
}

export function BrandLockup({
  className,
  markClassName,
  textClassName,
  ...props
}: BrandLockupProps) {
  const branding = useBranding();

  return (
    <div className={cn("flex items-center gap-2.5", className)} {...props}>
      <BrandMark
        alt=""
        aria-hidden="true"
        className={cn("h-8", markClassName)}
      />
      <span
        className={cn("text-lg font-semibold tracking-tight", textClassName)}
      >
        {branding.name}
      </span>
    </div>
  );
}
