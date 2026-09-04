import React from 'react';
import { t } from '@lib/i18n.js';
import { IconChevronLeft, IconClose } from '@assets';
import IconButton from '@components/IconButton/IconButton';
import LangStep from './LangStep';
import MethodStep from './MethodStep';
import ImportStep from './ImportStep';
import NpubStep from './NpubStep';
import Nip46Step from './Nip46Step';
import CreateStep from './CreateStep';
import SubAccountStep from './SubAccountStep';
import VerifyStep from './VerifyStep';
import PasswordStep from './PasswordStep';
import BackupStep from './BackupStep';
import FollowSuggestionsStep from './FollowSuggestionsStep';
import PermissionCopyStep from './PermissionCopyStep';
import DoneStep from './DoneStep';

interface WizardFlow {
  step: string;
  account: unknown;
  mnemonic: string | null;
  upgradeId: string | null;
  send: (type: string, payload?: Record<string, unknown>) => void;
  goBack: () => void;
  showBack: boolean;
  reset: () => void;
}

interface StepConfig {
  noHeader?: boolean;
  title?: string;
  content: React.ReactNode;
}

function buildSteps(
  flow: WizardFlow,
  onLangSelect: ((code: string) => void) | null,
  onDone: () => void,
  { hasAccounts, hasGeneratedAccount }: { hasAccounts?: boolean; hasGeneratedAccount?: boolean } = {},
): Record<string, StepConfig> {
  return {
    lang: {
      noHeader: true,
      content: onLangSelect ? <LangStep onSelect={onLangSelect} /> : null,
    },
    welcome: {
      noHeader: true,
      content: null, // welcome screen handled externally by OnboardingApp
    },
    method: {
      title: hasAccounts ? t('wizard.addAccount') : t('wizard.getStarted'),
      content: <MethodStep onSelect={(m: string) => flow.send('SELECT', { method: m })} hasGeneratedAccount={hasGeneratedAccount} />,
    },
    import: {
      title: t('wizard.importKey'),
      content: <ImportStep onNext={(acct: any, upId: string | null) => flow.send('IMPORTED', { account: acct, upgradeId: upId })} hasGeneratedAccount={hasGeneratedAccount} />,
    },
    npub: {
      title: t('wizard.watchOnly'),
      content: <NpubStep onNext={(acct: any) => flow.send('DONE', { account: acct })} />,
    },
    nip46: {
      title: t('wizard.nostrConnect'),
      content: <Nip46Step onNext={(acct: any) => flow.send('DONE', { account: acct })} />,
    },
    create: {
      title: t('wizard.createIdentity'),
      content: <CreateStep onNext={(acct: any, seed: string) => flow.send('CREATED', { account: acct, mnemonic: seed })} />,
    },
    subaccount: {
      title: t('wizard.subAccountTitle'),
      content: <SubAccountStep onNext={(acct: any) => flow.send('CREATED', { account: acct })} />,
    },
    backup: {
      title: t('wizard.backUpKeys'),
      content: <BackupStep mnemonic={flow.mnemonic} onNext={() => flow.send('DONE')} />,
    },
    verify: {
      title: t('wizard.verifyBackup'),
      content: <VerifyStep mnemonic={flow.mnemonic} onVerified={() => flow.send('VERIFIED')} />,
    },
    password: {
      title: t('wizard.setPassword'),
      content: (
        <PasswordStep
          account={flow.account}
          upgradeId={flow.upgradeId}
          onNext={(upgraded: boolean) => flow.send('SET', { upgraded })}
        />
      ),
    },
    followSuggestions: {
      title: t('wizard.followSuggestions'),
      content: <FollowSuggestionsStep onNext={() => flow.send('DONE')} />,
    },
    permCopy: {
      title: t('wizard.copyPermissions'),
      content: <PermissionCopyStep account={flow.account as any} onNext={() => flow.send('DONE')} />,
    },
    done: {
      title: t('wizard.allSet'),
      content: <DoneStep account={flow.account as any} onDone={onDone} />,
    },
  };
}

interface WizardStepsProps {
  flow: WizardFlow;
  onClose: (() => void) | null;
  onDone: () => void;
  onLangSelect: (code: string) => void;
  bodyClassName?: string;
  hasAccounts?: boolean;
  hasGeneratedAccount?: boolean;
}

export default function WizardSteps({ flow, onClose, onDone, onLangSelect, bodyClassName, hasAccounts, hasGeneratedAccount }: WizardStepsProps) {
  const STEPS = buildSteps(flow, onLangSelect, onDone, { hasAccounts, hasGeneratedAccount });
  const active = STEPS[flow.step];
  if (!active?.content) return null;

  // When user has accounts, back on the method step should close the wizard
  const showBack = flow.showBack || (flow.step === 'method' && !!hasAccounts);
  const handleBack = (flow.step === 'method' && hasAccounts) ? onClose : flow.goBack;

  return (
    <>
      {!active.noHeader && (
        <div className="flex items-center justify-between px-8 py-6 border-b border-card-border">
          {showBack ? (
            // Same tone/size split as OverlayPanel's header nav (back is
            // brand-coloured, close is neutral) — this header hand-rolled its
            // own copy of that pair instead of reusing it.
            <IconButton tone="brand" size={36} onClick={handleBack!} aria-label={t('common.back')}>
              <IconChevronLeft />
            </IconButton>
          ) : (
            <div className="w-[36px]" />
          )}
          <span className="text-2xl font-bold text-heading">{active.title}</span>
          {onClose ? (
            <IconButton size={36} onClick={onClose} aria-label={t('common.close')}>
              <IconClose />
            </IconButton>
          ) : (
            <div className="w-[36px]" />
          )}
        </div>
      )}
      {/* bodyClassName REPLACES the default padding rather than joining it —
          onboarding needs different padding, and two padding utilities on the
          same element would leave the winner up to Tailwind's generation
          order instead of the caller's intent. */}
      <div className={`flex-1 overflow-y-auto flex flex-col ${bodyClassName || 'pt-10 px-8 pb-0'}`}>
        {active.content}
      </div>
    </>
  );
}
