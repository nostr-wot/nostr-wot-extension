import React from 'react';
import { t } from '@services/i18n/i18n.ts';
import IconPlus from '@assets/IconPlus.tsx';
import IconKey from '@assets/IconKey.tsx';
import IconEye from '@assets/IconEye.tsx';
import IconLink from '@assets/IconLink.tsx';
import Card from '@components/Card';
import Heading from '@components/Heading';
import Container from '@components/Container';

const METHOD_ICONS: Record<string, React.ReactNode> = {
  create: <IconPlus />,
  import: <IconKey />,
  npub: <IconEye />,
  nip46: <IconLink />,
};

interface Method {
  id: string;
  label: string;
  desc: string;
  primary?: boolean;
  icon: React.ReactNode;
}

interface MethodStepProps {
  onSelect: (id: string) => void;
  hasGeneratedAccount?: boolean;
}

export default function MethodStep({ onSelect, hasGeneratedAccount }: MethodStepProps) {
  const METHODS: Method[] = [
    {
      id: 'create',
      label: hasGeneratedAccount ? t('wizard.createSubAccount') : t('wizard.createNew'),
      desc: hasGeneratedAccount ? t('wizard.createSubAccountDesc') : t('wizard.createNewDesc'),
      primary: true,
      icon: METHOD_ICONS.create,
    },
    { id: 'import', label: t('wizard.importKeyBackup'), desc: t('wizard.importKeyBackupDesc'), icon: METHOD_ICONS.import },
    { id: 'npub', label: t('wizard.watchOnly'), desc: t('wizard.watchOnlyDesc'), icon: METHOD_ICONS.npub },
    { id: 'nip46', label: t('wizard.nostrConnect'), desc: t('wizard.nostrConnectDesc'), icon: METHOD_ICONS.nip46 },
  ];

  return (
    <Container className="flex-1">
      <Heading className="mb-3">{t('wizard.chooseSetup')}</Heading>
      <Container gap={4} className="mt-auto pb-12">
        {METHODS.map((m, i) => (
          <React.Fragment key={m.id}>
            {i === 1 && (
              <Container variant="row" gap={6} className="py-2">
                <div className="flex-1 h-px bg-card-border" />
                <span className="text-xs font-semibold text-muted uppercase">{t('common.or')}</span>
                <div className="flex-1 h-px bg-card-border" />
              </Container>
            )}
            <Card
              as="button"
              variant="raised"
              className={`flex items-center gap-7 w-full p-8 mb-0 cursor-pointer text-left transition-all hover:bg-glass-heavy hover:translate-x-2 ${m.primary ? 'border-brand bg-[rgba(255,255,255,0.92)] shadow-[0_4px_20px_rgba(99,102,241,0.14)]' : ''}`}
              onClick={() => onSelect(m.id)}
            >
              <div className="w-18 h-18 rounded-panel bg-brand-light text-brand flex items-center justify-center shrink-0">{m.icon}</div>
              <div className="flex flex-col">
                <strong className="block text-lg font-semibold text-heading mb-1">{m.label}</strong>
                <span className="text-xs text-menu-subtitle">{m.desc}</span>
              </div>
            </Card>
          </React.Fragment>
        ))}
      </Container>
    </Container>
  );
}
