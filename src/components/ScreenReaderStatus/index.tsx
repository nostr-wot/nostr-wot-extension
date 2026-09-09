import type { ReactNode } from 'react';

interface ScreenReaderStatusProps {
  children?: ReactNode;
}

/** Keep mounted, including when empty, so feedback updates the status region. */
export default function ScreenReaderStatus({ children }: ScreenReaderStatusProps) {
  return <span role="status" className="sr-only">{children}</span>;
}
