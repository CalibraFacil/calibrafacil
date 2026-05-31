import { motion } from 'motion/react'

type RevealProps = React.ComponentProps<typeof motion.div> & {
  delay?: number
}

/**
 * Scroll-reveal wrapper matching the design system motion spec:
 * fade + small Y translate, once, default tween easing. Uses motion/react's
 * `whileInView`, so no scroll-observer effect is needed.
 */
export function Reveal({ delay = 0, children, ...props }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, delay }}
      {...props}
    >
      {children}
    </motion.div>
  )
}
