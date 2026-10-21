import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { ComponentPropsWithoutRef, ComponentRef, forwardRef } from "react";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { buttonVariants } from "./button-variants";

type ButtonProps = ComponentPropsWithoutRef<typeof ButtonPrimitive> &
  VariantProps<typeof buttonVariants>;

const Button = forwardRef<ComponentRef<typeof ButtonPrimitive>, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <ButtonPrimitive
        ref={ref}
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

export { Button, buttonVariants };
