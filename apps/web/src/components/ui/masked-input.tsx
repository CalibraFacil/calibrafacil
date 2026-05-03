import * as React from 'react'
import type { MaskitoOptions } from '@maskito/core'
import { useMaskito } from '@maskito/react'

import { Input } from '@/components/ui/input'
import { useComposedRefs } from '@/lib/compose-refs'

type MaskedInputProps = React.ComponentProps<typeof Input> & {
  maskOptions: MaskitoOptions
}

const MaskedInput = React.forwardRef<HTMLInputElement, MaskedInputProps>(
  ({ maskOptions, ...props }, ref) => {
    const maskRef = useMaskito({ options: maskOptions })
    const composedRef = useComposedRefs(ref, maskRef)

    return <Input ref={composedRef} {...props} />
  },
)

MaskedInput.displayName = 'MaskedInput'

export { MaskedInput }
