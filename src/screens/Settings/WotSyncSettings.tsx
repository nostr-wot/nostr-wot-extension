import InfoTooltip from '@components/InfoTooltip';
import type { WotSettings } from '@domain/wot/types.ts';
import { t } from '@services/i18n/i18n.ts';
import Card from '@components/Card';
import Container from '@components/Container';
import Input from '@components/Input';
import Tabs from '@components/Tabs';
import { SectionLabel } from '@components/SectionLabel';
import IconDatabase from '@assets/IconDatabase';
import IconCloud from '@assets/IconCloud';
import IconMerge from '@assets/IconMerge';

export default function WotSyncSettings({ draft, setDraft, disabled }: {
    draft: WotSettings; setDraft: (value: WotSettings) => void; disabled: boolean;
}) {
    return <Container gap={5}>
    <Card><Container gap={5}>
    <Container gap={3}>
      <SectionLabel>{t('wot.mode')}<InfoTooltip text={[t('wot.localDesc'), t('wot.remoteDesc'), t('wot.hybridDesc')].join(' ')}/></SectionLabel>
      <Tabs variant="cards" label={t('wot.mode')} value={draft.mode} disabled={disabled} onChange={mode => setDraft({ ...draft, mode })} options={[{ value: 'local', label: t('wot.local'), icon: <IconDatabase size={20}/> }, { value: 'remote', label: t('wot.remote'), icon: <IconCloud size={20}/> }, { value: 'hybrid', label: t('wot.hybrid'), icon: <IconMerge size={20}/> }]}/>
    </Container>
    {draft.mode !== 'local' && <Container gap={3}>
      <Input label={t('wot.oracleUrl')} hint={t('wot.oracleDisclosure')} value={draft.oracleUrl} placeholder="https://oracle.example" disabled={disabled} onChange={e => setDraft({ ...draft, oracleUrl: e.target.value })}/>
    </Container>}
    </Container></Card>
    <Card><Container gap={4}>
      <SectionLabel>{t('wot.depth')}<InfoTooltip text={t('wot.depthHint')}/></SectionLabel>
      <Tabs label={t('wot.depth')} value={String(draft.maxHops)} disabled={disabled} onChange={maxHops => setDraft({ ...draft, maxHops: Number(maxHops) })} options={[1, 2, 3].map(value => ({ value: String(value), label: String(value) }))}/>
    </Container></Card>
    <Card><Container gap={4}>
      <Input type="number" aria-label={t('wot.edgeLimit')} min={1} step={1} label={t('wot.edgeLimit')} hint={t('wot.edgeLimitHint')} placeholder={t('wot.unlimited')} value={draft.maxEdges ?? ''} disabled={disabled} onChange={e => setDraft({ ...draft, maxEdges: e.target.value === '' ? null : Number(e.target.value) })}/>
      <Input type="number" aria-label={t('wot.authorLimit')} min={1} step={1} label={t('wot.authorLimit')} hint={t('wot.authorLimitHint')} placeholder={t('wot.unlimited')} value={draft.maxAuthors ?? ''} disabled={disabled} onChange={e => setDraft({ ...draft, maxAuthors: e.target.value === '' ? null : Number(e.target.value) })}/>
      <Input type="number" aria-label={t('wot.followsLimit')} min={1} step={1} label={t('wot.followsLimit')} hint={t('wot.followsLimitHint')} placeholder={t('wot.unlimited')} value={draft.maxFollows ?? ''} disabled={disabled} onChange={e => setDraft({ ...draft, maxFollows: e.target.value === '' ? null : Number(e.target.value) })}/>
    </Container></Card>
    </Container>;
}
