import { ComponentPropsWithoutRef, ComponentRef, forwardRef } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";
import { buttonVariants } from "../lib/button-variants";

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

/** Sizes that render a square, label-less button. */
type IconButtonSize = "icon" | "icon-xs" | "icon-sm" | "icon-lg";

type ButtonBaseProps = ComponentPropsWithoutRef<typeof ButtonPrimitive> &
  Omit<ButtonVariantProps, "size">;

type TextButtonSize = Exclude<ButtonVariantProps["size"], IconButtonSize>;

type TextButtonProps = ButtonBaseProps & { size?: TextButtonSize };

/**
 * An icon-only button has no visible text, so a screen reader announces
 * nothing without an accessible name. The type makes the name mandatory
 * whenever one of the `icon*` sizes is chosen.
 */
type IconButtonProps = ButtonBaseProps & {
  size: IconButtonSize;
  "aria-label": string;
};

type ButtonProps = TextButtonProps | IconButtonProps;

const Button = forwardRef<ComponentRef<typeof ButtonPrimitive>, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const nativeButton =
      props.nativeButton ?? (props.render == null ? undefined : false);

    return (
      <ButtonPrimitive
        ref={ref}
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
        nativeButton={nativeButton}
      />
    );
  },
);

Button.displayName = "Button";

export { Button };
export type { ButtonProps, IconButtonSize, TextButtonSize };
