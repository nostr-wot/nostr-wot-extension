import type { ReactNode } from 'react';
import { version } from '../../../package.json';
import TopoBg from '@components/TopoBg';
import Card from '@components/Card';
import Container from '@components/Container';
import Text from '@components/Text';
import AnimatedWotLogo from '@components/AnimatedWotLogo';

interface ExtensionPageProps {
  children: ReactNode;
  /** Rendered outside the card, e.g. a full-screen dialog. */
  after?: ReactNode;
  cardTestId?: string;
}

/** A full extension tab: logo header, one centred card, version footer. */
export default function ExtensionPage({ children, after, cardTestId }: ExtensionPageProps) {
  return <TopoBg className="min-h-screen flex flex-col text-heading">
    <header className="w-full max-w-[1120px] mx-auto px-8 py-7 sm:px-12">
      <Container variant="row" gap={4} className="items-center">
        <span aria-hidden="true" className="text-brand"><AnimatedWotLogo size={40} /></span>
        <Text className="font-semibold text-lg">Nostr WoT</Text>
      </Container>
    </header>
    <main className="flex-1 flex items-center justify-center px-6 py-8 sm:px-12">
      <div className="w-full max-w-[540px]">
        <Card data-testid={cardTestId} className="w-full mb-0 p-8 sm:p-12">{children}</Card>
      </div>
    </main>
    {after}
    <footer className="px-8 py-7 text-center">
      <Text variant="hint">Nostr WoT · v{version}</Text>
    </footer>
  </TopoBg>;
}
