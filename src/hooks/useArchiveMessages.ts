import { useEffect, useRef, useState } from 'react';
import { rpc } from '@services/rpc';

export interface RevealedArchiveMessage {
  plaintext: string;
  senderPubkey?: string;
  decryptedEvent?: Record<string, unknown>;
}
interface MessageState { value?: RevealedArchiveMessage; loading?: boolean; error?: string }

/** Plaintext is scoped to one visible page and discarded on navigation or vault lock. */
export default function useArchiveMessages(accountId: string, scope: string) {
  const [messages, setMessages] = useState<Record<string, MessageState>>({});
  const session = useRef({ active: true, pending: new Set<string>(), values: new Set<string>() });
  useEffect(() => {
    const current = { active: true, pending: new Set<string>(), values: new Set<string>() };
    session.current = current;
    setMessages({});
    return () => { current.active = false; };
  }, [accountId, scope]);
  async function reveal(id: string) {
    const current = session.current;
    if (!current.active || current.pending.has(id) || current.values.has(id)) return;
    current.pending.add(id);
    setMessages(previous => ({ ...previous, [id]: { loading: true } }));
    try {
      const value = await rpc<RevealedArchiveMessage>('archive_reveal', { accountId, id });
      if (current.active) {
        current.values.add(id);
        setMessages(previous => ({ ...previous, [id]: { value } }));
      }
    } catch (error) {
      if (current.active) setMessages(previous => ({ ...previous, [id]: { error: (error as Error).message } }));
    } finally { current.pending.delete(id); }
  }
  async function revealAll(ids: string[]) {
    const current = session.current;
    for (const id of ids) {
      if (!current.active) break;
      await reveal(id);
    }
  }
  return { messages, reveal, revealAll, revealing: Object.values(messages).some(message => message.loading) };
}
