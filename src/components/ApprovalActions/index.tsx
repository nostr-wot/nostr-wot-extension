import type { ReactNode } from 'react';
import { t } from '@services/i18n/i18n.ts';
import ActionMenu from '@components/ActionMenu';
import Button from '@components/Button';
import Container from '@components/Container';
import IconChevronDown from '@assets/IconChevronDown';

type Action = () => void | Promise<void>;
interface ApprovalChoice {
    value: string;
    label: string;
    allowLabel?: string;
    denyLabel?: string;
    onAlwaysAllow?: Action;
    onAlwaysDeny?: Action;
}

/** Shared decisions for both the pending sheet and its event detail view. */
export default function ApprovalActions({ choices, requestCount, rejectCount = requestCount, busy, onApprove, onReject, placement = 'below', approveLabel, rejectLabel, approveDescription }: {
    choices: ApprovalChoice[]; requestCount: number; rejectCount?: number; busy: boolean;
    onApprove?: Action; onReject?: Action;
    placement?: 'above' | 'below';
    approveDescription?: ReactNode;
    approveLabel?: string;
    rejectLabel?: string;
}) {
    if (!requestCount) return null;
    const actions = [
        {key:'approve',label:requestCount === 1 ? 'approval.approveOnce' : 'approval.approveShown',options:'approval.approveOptions',always:'approval.alwaysAllowLabel',run:onApprove,remember:'onAlwaysAllow' as const,variant:'primary' as const},
        {key:'reject',label:rejectCount === 1 ? 'approval.deny' : 'approval.rejectAll',options:'approval.rejectOptions',always:'approval.alwaysDenyLabel',run:onReject,remember:'onAlwaysDeny' as const,variant:'danger' as const},
    ];
    return <Container variant="row" gap={4} className="shrink-0 justify-end">
        {actions.map(action => <Container key={action.key} variant="row" className="relative min-w-0">
            <Button variant={action.variant} outline={action.key === 'reject'} small disabled={busy || !action.run}
                segment="start" onClick={() => { void action.run?.(); }}>
                {(action.key === 'approve' ? approveLabel : rejectLabel) || t(action.label)}
            </Button>
            <ActionMenu description={action.key === 'approve' ? approveDescription : undefined} label={t(action.options)} placement={placement} anchorToParent
                disabled={busy || !choices.some(choice => choice[action.remember])} tone={action.key === 'reject' ? 'danger' : 'neutral'}
                options={choices.filter(choice => choice[action.remember]).map(({value, label, allowLabel, denyLabel}) => ({
                    value,
                    label: (action.key === 'approve' ? allowLabel : denyLabel) || (choices.filter(choice => choice[action.remember]).length === 1
                      ? t(action.key === 'approve' ? 'approval.detail.alwaysAllow' : 'approval.detail.alwaysDeny')
                      : t(action.always, {label})),
                }))}
                onSelect={async value => {
                    const selected = choices.find(choice => choice.value === value);
                    if (selected) await selected[action.remember]?.();
                }}
                trigger={props => <Button {...props} variant={action.variant} outline={action.key === 'reject'} small segment="end"><IconChevronDown/></Button>}/>

        </Container>)}
    </Container>;
}
