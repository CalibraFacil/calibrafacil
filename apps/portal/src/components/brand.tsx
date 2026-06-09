import { cn } from "@/lib/utils";
import { useBranding } from "@/features/branding/branding-context";

type BrandMarkProps = Omit<React.ComponentProps<"img">, "src">;

interface BrandLockupProps extends React.ComponentProps<"div"> {
  markClassName?: string;
  textClassName?: string;
}

export function BrandMark({ alt, className, ...props }: BrandMarkProps) {
  const branding = useBranding();
  // Preserve an explicitly-empty alt (decorative usage); otherwise default to
  // the resolved brand name.
  const altText = alt ?? branding.name;

  if (branding.logo) {
    return (
      <span className={cn("relative inline-flex size-8 shrink-0", className)}>
        <img
          src={branding.logo}
          alt={altText}
          className="size-full object-contain"
          draggable={false}
          {...props}
        />
      </span>
    );
  }

  return (
    <span className={cn("relative inline-flex size-8 shrink-0", className)}>
      <img
        src="/logo-mark-light.svg"
        alt={altText}
        className="size-full dark:hidden"
        draggable={false}
        {...props}
      />
      <img
        src="/logo-mark-dark.svg"
        alt={altText}
        className="hidden size-full dark:block"
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
        className={cn("size-8", markClassName)}
      />
      <span
        className={cn("text-lg font-semibold tracking-tight", textClassName)}
      >
        {branding.name}
      </span>
    </div>
  );
}
