import React from 'react';
import TopoBg from '../TopoBg/TopoBg';
import PulseLogo from '../PulseLogo/PulseLogo';
import styles from './Splash.module.css';

// rgba(255,255,255,0.88) is a one-off, distinct from both --surface-glass
// (0.85) and --surface-glass-heavy (0.95). The [transition:...] arbitrary
// property keeps the exact `opacity 0.4s ease` -- Tailwind's own
// transition-opacity utility would pull in the house-default 0.15s instead.
const SPLASH_BASE =
  'z-splash flex flex-col items-center justify-center bg-[rgba(255,255,255,0.88)] backdrop-blur-[16px] ' +
  '[transition:opacity_0.4s_ease]';
const FADE_OUT = 'opacity-0 pointer-events-none';

interface SplashProps {
  visible?: boolean;
  onTransitionEnd?: () => void;
}

export default function Splash({ visible = true, onTransitionEnd }: SplashProps) {
  return (
    <TopoBg className={`${styles.splash} ${SPLASH_BASE} ${visible ? '' : FADE_OUT}`}>
      <PulseLogo src="/icons/icon-base.svg" size={96} />
    </TopoBg>
  );
}
