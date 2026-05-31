import { cn } from '@/lib/utils'

type BrandMarkProps = Omit<React.ComponentProps<'img'>, 'src'>

interface BrandLockupProps extends React.ComponentProps<'div'> {
  markClassName?: string
  textClassName?: string
}

export function BrandMark({
  alt = 'CalibraFácil',
  className,
  ...props
}: BrandMarkProps) {
  return (
    <span className={cn('relative inline-flex size-8 shrink-0', className)}>
      <img
        src="/logo-mark-light.svg"
        alt={alt}
        className="size-full dark:hidden"
        draggable={false}
        {...props}
      />
      <img
        src="/logo-mark-dark.svg"
        alt={alt}
        className="hidden size-full dark:block"
        draggable={false}
        {...props}
      />
    </span>
  )
}

export function BrandLockup({
  className,
  markClassName,
  textClassName,
  ...props
}: BrandLockupProps) {
  return (
    <div className={cn('flex items-center gap-2.5', className)} {...props}>
      <BrandMark
        alt=""
        aria-hidden="true"
        className={cn('size-8', markClassName)}
      />
      <span
        className={cn('text-lg font-semibold tracking-tight', textClassName)}
      >
        CalibraFácil
      </span>
    </div>
  )
}
