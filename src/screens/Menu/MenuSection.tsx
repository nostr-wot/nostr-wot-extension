import { ReactNode } from 'react';

interface MenuSectionProps {
  children: ReactNode;
}

export default function MenuSection({ children }: MenuSectionProps) {
  return <div className="flex flex-col gap-2 py-2 px-1">{children}</div>;
}
