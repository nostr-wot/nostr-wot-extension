import WotScoreResultModal from './WotScoreResultModal';
import IconButton from '@components/IconButton';
import IconSettings from '@assets/IconSettings';
import { useState } from 'react';
import { wotPubkey } from '@domain/wot/validation.ts';
import { t } from '@services/i18n/i18n.ts';
import Card from '@components/Card';
import Container from '@components/Container';
import Input from '@components/Input';
import Button from '@components/Button';
import Text from '@components/Text';
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
    return <><Card><Container gap={4}>
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
    </Container></Card>
        {!disabled && submitted && <WotScoreResultModal key={submitted + revision + attempt} target={submitted} onClose={() => setSubmitted(null)}/>}
    </>;
}
