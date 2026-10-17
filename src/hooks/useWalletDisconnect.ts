import { useState } from 'react';
import { rpc } from '@services/rpc.ts';

/** Both wallet entry points retain the connection and expose failures when disconnect fails. */
export default function useWalletDisconnect(onDisconnected: () => void) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');
  const disconnect = async () => {
    if (disconnecting) return;
    setDisconnecting(true); setDisconnectError('');
    try { await rpc('wallet_disconnect'); onDisconnected(); }
    catch (error) { setDisconnectError((error as Error).message); setDisconnecting(false); }
  };
  return { disconnect, disconnecting, disconnectError };
}
