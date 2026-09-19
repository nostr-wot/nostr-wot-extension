import IconButton from '@components/IconButton';
import IconSettings from '@assets/IconSettings';
import { useState } from 'react';
import { wotPubkey } from '@domain/wot/validation.ts';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import Card from '@components/Card';
import Container from '@components/Container';
import Input from '@components/Input';
import Button, { ButtonSecondary } from '@components/Button';
import Text from '@components/Text';
import FieldDisplay from '@components/FieldDisplay';
import FormError from '@components/FormError';
import { SectionLabel } from '@components/SectionLabel';

/** Uses the same saved query mode, mute rules and scoring service as the page API. */
export default function WotScoreLookup({ disabled, onSettings, revision }: {
    disabled: boolean; onSettings: () => void; revision: string;
}) {
    const [input, setInput] = useState('');
    const [attempt, setAttempt] = useState(0);
    const [submitted, setSubmitted] = useState<string | null>(null);
    let target = '';
    try { target = wotPubkey(input.trim()); } catch { /* Validation is shown below the field. */ }
    return <Card><Container gap={4}>
        <Container variant="row" className="justify-between" gap={4}>
            <SectionLabel>{t('wot.scoring')}</SectionLabel>
            <IconButton aria-label={t('wot.scoringSettings')} title={t('wot.scoringSettings')} onClick={onSettings}><IconSettings/></IconButton>
        </Container>
        <Text variant="secondary">{t('wot.lookupHint')}</Text>
        <form onSubmit={event => { event.preventDefault(); if (target && !disabled) { setSubmitted(target); setAttempt(value => value + 1); } }}>
            <Container gap={4}>
                <Input type="search" label={t('wot.lookupPubkey')} aria-label={t('wot.lookupPubkey')} placeholder="npub1…" value={input} error={input.trim() && !target ? t('wot.invalidPubkey') : ''} onChange={event => { setInput(event.target.value); setSubmitted(null); }}/>
                <Button type="submit" disabled={disabled || !target}>{t('wot.calculateScore')}</Button>
            </Container>
        </form>
        {!disabled && submitted && <ScoreResult key={submitted + revision + attempt} target={submitted}/>}
    </Container></Card>;
}

function ScoreResult({ target }: { target: string }) {
    const resource = useAsyncResource<{ score: number | null }>({ score: null }, { load: async (patch, isCurrent) => {
        const score = await rpc<number | null>('experimentalWot_getTrustScore', { target });
        if (isCurrent()) patch({ score });
    } });
    return <Container gap={3} role="status" aria-live="polite">
        {resource.loading ? <Text>{t('wot.calculating')}</Text> : !resource.error && (resource.data.score === null
            ? <Text variant="secondary">{t('wot.scoreUnavailable')}</Text>
            : <FieldDisplay label={t('wot.score')} value={`${Number((resource.data.score * 100).toFixed(2))} / 100`}/>)}
        <FormError>{resource.error}</FormError>
        {resource.error && <ButtonSecondary onClick={() => { void resource.refresh(); }}>{t('common.retry')}</ButtonSecondary>}
    </Container>;
}
