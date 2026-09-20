import type { WotScoreExplanation } from '@domain/wot/types.ts';
import { t } from '@services/i18n/i18n.ts';
import Container from '@components/Container';
import FieldDisplay from '@components/FieldDisplay';
import Text from '@components/Text';

/** Present only evidence used by the shared query engine, without another traversal. */
export default function WotScoreBreakdown({ result }: { result: WotScoreExplanation }) {
    const { details } = result;
    return <Container gap={2}>
        {result.score === null ? <Text variant="secondary">{t('wot.scoreUnavailable')}</Text>
            : <FieldDisplay label={t('wot.score')} value={`${Number((result.score * 100).toFixed(2))} / 100`}/>}
        <Text variant="secondary" className={result.source === 'muted' ? 'text-error' : 'text-menu-subtitle'}>{result.source === 'muted' && '− '}{t(`wot.explanation.${result.source}`)}</Text>
        <FieldDisplay label={t('wot.explanation.searchDepth')} value={result.maxHops}/>
        {details && <>
            <FieldDisplay label={t('wot.explanation.hops')} value={details.hops}/>
            <FieldDisplay label={t('wot.explanation.paths')} value={details.paths ?? t('wot.explanation.unknown')}/>
            <Text variant="hint" className="text-menu-subtitle">{t('wot.explanation.pathsHint')}</Text>
            {([['base', result.baseScore], ['bonus', result.appliedBonus]] as const).map(([label, value]) =>
                <FieldDisplay key={label} label={t(`wot.explanation.${label}`)}
                    valueClassName={(value ?? 0) < 0 ? 'text-error' : 'text-success'}
                    value={`${(value ?? 0) < 0 ? '−' : '+'}${Number((Math.abs(value ?? 0) * 100).toFixed(2))}`}/>)}
            <Text variant="hint" className="text-menu-subtitle">{t('wot.explanation.formula')}</Text>
        </>}
        {(result.muteStatus !== 'ready' || result.knownMutes > 0) && <Text variant="secondary">{t(result.muteStatus === 'ready'
            ? 'wot.explanation.mutesExcluded'
            : result.muteStatus === 'private-unavailable' ? 'wot.explanation.privateUnavailable' : 'wot.explanation.mutesUnavailable')}</Text>}

    </Container>;
}
