import type { ReactNode } from 'react';
import SiteIcon from '@components/SiteIcon';

/** Site identity and actions stay visible while the rules scroll. */
export default function PermissionsDetailLayout({ domain, children, actions }: {
  domain: string; children?: ReactNode; actions: ReactNode;
}) {
  return <div className="flex flex-col flex-1 min-h-0 gap-5 py-2">
    <div className="flex items-center gap-4 shrink-0 pb-5 border-b border-card-border">
      <SiteIcon domain={domain} />
      <span className="text-lg font-semibold text-heading break-all min-w-0">{domain}</span>
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-5">{children}</div>
    <div className="shrink-0 pt-5 border-t border-card-border">{actions}</div>
  </div>;
}
