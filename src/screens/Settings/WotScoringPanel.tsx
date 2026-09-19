import type { WotScoring } from '@domain/wot/types.ts';
import { WOT_SCORING } from '@constants/wot.ts';
import { t } from '@services/i18n/i18n.ts';
import Container from '@components/Container';
import Input from '@components/Input';
import Text from '@components/Text';
import { ButtonSecondary } from '@components/Button';

export default function WotScoringPanel({ value, onChange, disabled }: { value: WotScoring; onChange: (value: WotScoring) => void; disabled: boolean }) {
    return <Container gap={4}>
        <Text variant="secondary">{t('wot.scoringHint')}</Text>
        <Container variant="row" gap={3}>
            {([1, 2, 3] as const).map(hop => <Input key={hop} label={`${t('wot.hopWeight')} ${hop}`} type="number" min={0} max={1} step={0.05} disabled={disabled} value={Number.isFinite(value.distanceWeights[hop]) ? value.distanceWeights[hop] : ''} onChange={e => onChange({ ...value, distanceWeights: { ...value.distanceWeights, [hop]: e.target.value === '' ? NaN : Number(e.target.value) } })}/>)}
        </Container>
        <Container variant="row" gap={3}>
            {([2, 3] as const).map(hop => <Input key={hop} label={`${t('wot.pathBonus')} ${hop}`} type="number" min={0} max={1} step={0.05} disabled={disabled} value={Number.isFinite(value.pathBonus[hop]) ? value.pathBonus[hop] : ''} onChange={e => onChange({ ...value, pathBonus: { ...value.pathBonus, [hop]: e.target.value === '' ? NaN : Number(e.target.value) } })}/>)}
        </Container>
        <Input label={t('wot.bonusCap')} type="number" min={0} max={1} step={0.05} disabled={disabled} value={Number.isFinite(value.maxPathBonus) ? value.maxPathBonus : ''} onChange={e => onChange({ ...value, maxPathBonus: e.target.value === '' ? NaN : Number(e.target.value) })}/>
        <Text variant="secondary">{t('wot.muteOverride')}</Text>
        <ButtonSecondary disabled={disabled} onClick={() => onChange(structuredClone(WOT_SCORING))}>{t('wot.resetScoring')}</ButtonSecondary>
    </Container>;
}
