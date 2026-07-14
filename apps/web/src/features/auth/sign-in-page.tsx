import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { BrandLockup } from '@/components/brand'
import { SignInForm } from '@/components/sign-in-form'
import { SsoSignInForm } from '@/components/sso-sign-in-form'
import { SignInShaderPanel } from '@/features/auth/components/sign-in-shader-panel'

type SignInScene = 'credentials' | 'sso'

// One spring for the panel slide and the form reveals so the whole scene
// change reads as a single gesture. Springs retarget mid-flight, keeping
// rapid toggling interruptible.
const sceneSpring = { type: 'spring', duration: 0.7, bounce: 0 } as const

interface SignInPageProps {
  redirect?: string
}

export function SignInPage({ redirect }: SignInPageProps) {
  const [scene, setScene] = useState<SignInScene>('credentials')
  const isSso = scene === 'sso'

  return (
    <div className="relative grid min-h-svh overflow-hidden lg:grid-cols-2">
      <SceneCell
        isActive={!isSso}
        // Revealed by the panel sliding right → content follows from the left.
        revealFromX={16}
      >
        <div className="flex justify-center gap-2 md:justify-start">
          <Link to="/" className="flex items-center gap-2 font-medium">
            <BrandLockup markClassName="size-7" />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <SignInForm
              redirect={redirect}
              onSwitchToSso={() => setScene('sso')}
            />
          </div>
        </div>
      </SceneCell>

      <SceneCell
        isActive={isSso}
        // Revealed by the panel sliding left → content follows from the right.
        revealFromX={-16}
      >
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <SsoSignInForm
              redirect={redirect}
              onBack={() => setScene('credentials')}
            />
          </div>
        </div>
      </SceneCell>

      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-1/2 p-3 lg:block"
        initial={false}
        animate={{ x: isSso ? '0%' : '100%' }}
        transition={sceneSpring}
      >
        <SignInShaderPanel />
      </motion.div>
    </div>
  )
}

function SceneCell({
  isActive,
  revealFromX,
  children,
}: {
  isActive: boolean
  revealFromX: number
  children: React.ReactNode
}) {
  return (
    <div
      inert={!isActive}
      className={cn(
        'flex-col gap-4 p-6 md:p-10',
        isActive ? 'flex' : 'hidden lg:flex',
      )}
    >
      <motion.div
        className="flex flex-1 flex-col gap-4"
        initial={false}
        animate={
          isActive
            ? { opacity: 1, x: 0, filter: 'blur(0px)' }
            : { opacity: 0, x: revealFromX, filter: 'blur(4px)' }
        }
        transition={sceneSpring}
      >
        {children}
      </motion.div>
    </div>
  )
}
