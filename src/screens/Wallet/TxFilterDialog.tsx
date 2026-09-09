import { useState, ChangeEvent } from 'react';
import { t } from '@services/i18n/i18n.ts';
import Input from '@components/Input';
import Button, { ButtonSecondary } from '@components/Button';
import Modal from '@components/Modal';
import ChipGroup from '@components/ChipGroup';
import type { TxFilters } from '@domain/wallet/txFilter.ts';
import Container from '@components/Container';

interface TxFilterDialogProps {
  /** What is applied right now — the drafts start here. */
  initial: TxFilters;
  onApply: (filters: TxFilters) => void;
  onClose: () => void;
}

/**
 * The transaction filter form.
 *
 * The three draft values live here rather than in Wallet because the dialog is
 * mounted only while it is open: opening it seeds the drafts from what is
 * applied, and closing it discards them. That is what the parent's
 * `openFilterPopover` was doing by hand — copying three applied values into
 * three draft `useState`s that otherwise sat in the component forever.
 */
export default function TxFilterDialog({ initial, onApply, onClose }: TxFilterDialogProps) {
  const [direction, setDirection] = useState<TxFilters['direction']>(initial.direction);
  const [dateFrom, setDateFrom] = useState<string>(initial.dateFrom);
  const [dateTo, setDateTo] = useState<string>(initial.dateTo);

  const clear = () => { setDirection('all'); setDateFrom(''); setDateTo(''); };

  return (
    <Modal
      title={t('wallet.filtersTitle')}
      onClose={onClose}
      maxWidth={280}
      footerRow
      footer={(
        <>
          <ButtonSecondary small onClick={clear}>{t('wallet.filterClear')}</ButtonSecondary>
          <Button small onClick={() => onApply({ direction, dateFrom, dateTo })}>
            {t('wallet.filterApply')}
          </Button>
        </>
      )}
    >
      <Container gap={3}>
        <span className="text-xs font-semibold text-muted uppercase tracking-[0.4px]">{t('wallet.filterDirection')}</span>
        <ChipGroup
          options={[
            { value: 'all', label: t('wallet.filterAll') },
            { value: 'in', label: t('wallet.txReceived') },
            { value: 'out', label: t('wallet.txSent') },
          ]}
          value={direction}
          onChange={(v) => setDirection(v as TxFilters['direction'])}
        />
      </Container>
      <Container gap={3}>
        <span className="text-xs font-semibold text-muted uppercase tracking-[0.4px]">{t('wallet.filterDateRange')}</span>
        <Container variant="row" gap={2}>
          <Input small
            type="date"
            aria-label={t('wallet.filterDateRange')}
            className="min-h-16 px-3 text-xs"
            value={dateFrom}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDateFrom(e.target.value)}
          />
          <span className="text-xs text-muted shrink-0">—</span>
          <Input small
            type="date"
            aria-label={t('wallet.filterDateRange')}
            className="min-h-16 px-3 text-xs"
            value={dateTo}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDateTo(e.target.value)}
          />
        </Container>
      </Container>
    </Modal>
  );
}
