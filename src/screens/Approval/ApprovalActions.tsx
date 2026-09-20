import { t } from '@services/i18n/i18n.ts';
import { formatPermissionLabel } from '@services/i18n/permissionLabels.ts';
import type { ApprovalGroup } from '@domain/permissions/approval.ts';
import ActionMenu from '@components/ActionMenu';
import Button from '@components/Button';
import Container from '@components/Container';
import IconChevronDown from '@assets/IconChevronDown';

export default function ApprovalActions({ groups, busy, onApprove, onReject, onAlwaysAllow, onAlwaysDeny }: {
    groups: ApprovalGroup[]; busy: boolean;
    onApprove: () => Promise<void>; onReject: () => Promise<void>;
    onAlwaysAllow: (group: ApprovalGroup) => Promise<void>;
    onAlwaysDeny: (group: ApprovalGroup) => Promise<void>;
}) {
    if (!groups.length) return null;
    const requestCount = groups.reduce((count, group) => count + group.requests.length, 0);
    const choices = groups.map(group => ({
        value: JSON.stringify([group.requests[0]?.accountId, group.origin, group.permKey]),
        group,
    }));
    const actions = [
        {key:'approve',label:requestCount === 1 ? 'approval.approveOnce' : 'approval.approveShown',options:'approval.approveOptions',always:'approval.alwaysAllowLabel',run:onApprove,remember:onAlwaysAllow,variant:'primary' as const},
        {key:'reject',label:'approval.rejectAll',options:'approval.rejectOptions',always:'approval.alwaysDenyLabel',run:onReject,remember:onAlwaysDeny,variant:'danger' as const},
    ];
    return <Container variant="row" gap={4} className="shrink-0 justify-end mb-6">
        {actions.map(action => <Container key={action.key} variant="row" className="relative min-w-0">
            <Button variant={action.variant} outline={action.key === 'reject'} small disabled={busy}
                segment="start" onClick={() => { void action.run(); }}>
                {t(action.label)}
            </Button>
            <ActionMenu label={t(action.options)} placement="below" anchorToParent matchAnchorWidth
                disabled={busy} tone={action.key === 'reject' ? 'danger' : 'neutral'}
                options={choices.map(({value, group}) => ({
                    value,
                    label: t(action.always, {label: formatPermissionLabel(group.permKey, group.requests[0]?.event ?? undefined)}),
                }))}
                onSelect={async value => {
                    const selected = choices.find(choice => choice.value === value);
                    if (selected) await action.remember(selected.group);
                }}
                trigger={props => <Button {...props} variant={action.variant} outline={action.key === 'reject'} small segment="end"><IconChevronDown/></Button>}/>

        </Container>)}
    </Container>;
}
