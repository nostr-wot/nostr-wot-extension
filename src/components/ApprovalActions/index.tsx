import { t } from '@services/i18n/i18n.ts';
import ActionMenu from '@components/ActionMenu';
import Button from '@components/Button';
import Container from '@components/Container';
import IconChevronDown from '@assets/IconChevronDown';

type Action = () => void | Promise<void>;
interface ApprovalChoice {
    value: string;
    label: string;
    onAlwaysAllow?: Action;
    onAlwaysDeny?: Action;
}

/** Shared decisions for both the pending sheet and its event detail view. */
export default function ApprovalActions({ choices, requestCount, busy, onApprove, onReject, placement = 'below' }: {
    choices: ApprovalChoice[]; requestCount: number; busy: boolean;
    onApprove?: Action; onReject?: Action;
    placement?: 'above' | 'below';
}) {
    if (!requestCount) return null;
    const actions = [
        {key:'approve',label:requestCount === 1 ? 'approval.approveOnce' : 'approval.approveShown',options:'approval.approveOptions',always:'approval.alwaysAllowLabel',run:onApprove,remember:'onAlwaysAllow' as const,variant:'primary' as const},
        {key:'reject',label:'approval.rejectAll',options:'approval.rejectOptions',always:'approval.alwaysDenyLabel',run:onReject,remember:'onAlwaysDeny' as const,variant:'danger' as const},
    ];
    return <Container variant="row" gap={4} className="shrink-0 justify-end">
        {actions.map(action => <Container key={action.key} variant="row" className="relative min-w-0">
            <Button variant={action.variant} outline={action.key === 'reject'} small disabled={busy || !action.run}
                segment="start" onClick={() => { void action.run?.(); }}>
                {t(action.label)}
            </Button>
            <ActionMenu label={t(action.options)} placement={placement} anchorToParent matchAnchorWidth
                disabled={busy || !choices.some(choice => choice[action.remember])} tone={action.key === 'reject' ? 'danger' : 'neutral'}
                options={choices.filter(choice => choice[action.remember]).map(({value, label}) => ({
                    value,
                    label: t(action.always, {label}),
                }))}
                onSelect={async value => {
                    const selected = choices.find(choice => choice.value === value);
                    if (selected) await selected[action.remember]?.();
                }}
                trigger={props => <Button {...props} variant={action.variant} outline={action.key === 'reject'} small segment="end"><IconChevronDown/></Button>}/>

        </Container>)}
    </Container>;
}
