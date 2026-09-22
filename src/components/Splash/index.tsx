import TopoBg from '../TopoBg';
import PulseLogo from '../PulseLogo';
import { cn } from '@utils/cn.ts';

// Uses the shared glass surface so loading respects the selected palette.
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
  'absolute inset-0 z-splash flex flex-col items-center justify-center bg-glass-heavy ' +
  'backdrop-blur-[16px] [transition:opacity_0.4s_ease]';
const FADE_OUT = 'opacity-0 pointer-events-none';

interface SplashProps {
  visible?: boolean;
}

export default function Splash({ visible = true }: SplashProps) {
  return (
    <TopoBg className={cn(SPLASH_BASE, visible ? '' : FADE_OUT)}>
      <PulseLogo src="/icons/icon-base.svg" size={96} />
    </TopoBg>
  );
}
