import React from 'react';
import TopoBg from '../TopoBg/TopoBg';
import PulseLogo from '../PulseLogo/PulseLogo';
import { cn } from '@utils/cn.ts';

// rgba(255,255,255,0.88) is a one-off, distinct from both --surface-glass
// (0.85) and --surface-glass-heavy (0.95). The [transition:...] arbitrary
// property keeps the exact `opacity 0.4s ease` -- Tailwind's own
// transition-opacity utility would pull in the house-default 0.15s instead.
//
// `absolute inset-0` used to need an unlayered CSS Modules rule to outrank
// TopoBg's own `relative` (unlayered CSS always beats layered utility CSS at
// equal specificity, and Splash must cover the popup — a shipped bug had a
// wallet dialog painting over the unlock surface this same mechanism guards).
// TopoBg now composes with `cn(OWN, className)`, so passing `absolute` as a
// plain utility here resolves the conflict before the class string ever
// reaches the DOM: cn() drops TopoBg's `relative` in favour of this `absolute`
// because both belong to the same `position` group.
const SPLASH_BASE =
  'absolute inset-0 z-splash flex flex-col items-center justify-center bg-[rgba(255,255,255,0.88)] ' +
  'backdrop-blur-[16px] [transition:opacity_0.4s_ease]';
const FADE_OUT = 'opacity-0 pointer-events-none';

interface SplashProps {
  visible?: boolean;
  onTransitionEnd?: () => void;
}

export default function Splash({ visible = true, onTransitionEnd }: SplashProps) {
  return (
    <TopoBg className={cn(SPLASH_BASE, visible ? '' : FADE_OUT)}>
      <PulseLogo src="/icons/icon-base.svg" size={96} />
    </TopoBg>
  );
}
