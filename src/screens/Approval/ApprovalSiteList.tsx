import type { ApprovalGroup } from '@domain/permissions/approval.ts';
import Container from '@components/Container';
import Heading from '@components/Heading';
import SiteIcon from '@components/SiteIcon';
import ApprovalCard from './ApprovalCard';

/** Presentation only: keep permission/destination groups intact inside each site. */
export default function ApprovalSiteList({groups,onSelect,onCancel}:{groups:ApprovalGroup[];onSelect:(group:ApprovalGroup)=>void;onCancel:(group:ApprovalGroup)=>void}) {
  const sites = new Map<string,ApprovalGroup[]>();
  for (const group of groups) {
    const entries = sites.get(group.origin) || [];
    entries.push(group);
    sites.set(group.origin,entries);
  }
  return <Container gap={6}>
    {[...sites].map(([origin,entries]) => <Container as="section" key={origin} gap={4} className="shrink-0" data-approval-site={origin} aria-label={origin}>
      <Container variant="row" gap={4}>
        <SiteIcon domain={origin}/>
        <Heading level={5} as="h3" className="min-w-0 break-all m-0">{origin}</Heading>
      </Container>
      {entries.map(group => <ApprovalCard key={JSON.stringify([group.nip46InFlight,group.permKey,group.requests.map(request=>request.id)])}
        group={group} hideSite onClick={()=>onSelect(group)} onCancel={group.nip46InFlight ? ()=>onCancel(group) : undefined}/>)}
    </Container>)}
  </Container>;
}
