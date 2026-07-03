import { useContext, useEffect, useMemo, useState } from 'react';
import { ConnectionContext, WalletContext } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import './App.css';

type TelemetryEntry = {
  id: string;
  commandSent: string;
  success: boolean;
  timestamp: string;
};

const DEFAULT_FORKLIFT_ID = 'forklift-001';
const API_BASE = import.meta.env.VITE_API_URL ?? '';

function App() {
  const connectionContext = useContext(ConnectionContext);
  const walletContext = useContext(WalletContext);
  const connection = connectionContext?.connection;
  const publicKey = walletContext?.publicKey ?? null;
  const connected = walletContext?.connected ?? false;
  const disconnect = walletContext?.disconnect;
  const signMessage = walletContext?.signMessage ?? null;
  const [authState, setAuthState] = useState('Not authenticated');
  const [token, setToken] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryEntry[]>([]);
  const [statusMessage, setStatusMessage] = useState('Awaiting operator auth');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletAddress = publicKey?.toBase58() ?? 'Not connected';
  const message = useMemo(
    () => `Authorize RAID forklift control at ${new Date().toISOString()}`,
    [connected],
  );

  const fetchTelemetry = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/forklift/${DEFAULT_FORKLIFT_ID}/telemetry`);
      if (!response.ok) {
        throw new Error('Telemetry request failed');
      }
      const data = (await response.json()) as TelemetryEntry[];
      setTelemetry(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    void fetchTelemetry();
  }, []);

  const handleLogin = async () => {
    if (!publicKey || !signMessage) {
      setError('Connect a Solana wallet first');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const encodedMessage = new TextEncoder().encode(message);
      const signatureResult = await signMessage(encodedMessage);
      const signature = Buffer.from(signatureResult).toString('base64');

      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          message,
          signature,
        }),
      });

      const data = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !data.token) {
        throw new Error(data.error ?? 'Authentication failed');
      }

      setToken(data.token);
      setAuthState('Authenticated');
      setStatusMessage('Operator confirmed. Ready to dispatch commands.');
      await fetchTelemetry();
    } catch (err) {
      setAuthState('Authentication failed');
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const sendCommand = async (command: string) => {
    if (!token) {
      setError('Authenticate with your wallet before sending a command');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/forklift/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ forkliftId: DEFAULT_FORKLIFT_ID, command }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? 'Command failed');
      }

      setStatusMessage(`Command ${command} dispatched successfully`);
      await fetchTelemetry();
    } catch (err) {
      setStatusMessage('Dispatch failed. Emergency fallback engaged.');
      setError(err instanceof Error ? err.message : 'Command failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="dashboard-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">RAID | Industrial IoT</p>
          <h1>Forklift command center</h1>
          <p className="hero-copy">
            Authorize an operator wallet, dispatch forklift controls, and capture every command in
            NeonDB-backed telemetry.
          </p>
        </div>
        <div className="wallet-card">
          <div className="row-between">
            <span>Solana wallet</span>
            <WalletMultiButton />
          </div>
          <div className="wallet-details">
            <p>
              <strong>Status:</strong> {connected ? 'Connected' : 'Disconnected'}
            </p>
            <p>
              <strong>Wallet:</strong> {walletAddress}
            </p>
            <p>
              <strong>Backend auth:</strong> {authState}
            </p>
          </div>
          <div className="actions-row">
            <button type="button" className="primary" onClick={handleLogin} disabled={loading || !connected}>
              {loading ? 'Signing…' : 'Authorize operator'}
            </button>
            <button type="button" className="secondary" onClick={() => disconnect?.().catch(() => undefined)}>
              Disconnect
            </button>
          </div>
        </div>
      </section>

      <section className="status-grid">
        <article className="status-card">
          <h2>Connection state</h2>
          <p>{statusMessage}</p>
          <p className="meta">RPC: {connection?.rpcEndpoint ?? 'Unavailable'}</p>
        </article>
        <article className="status-card">
          <h2>Telemetry stream</h2>
          <ul>
            {telemetry.slice(0, 5).map((entry) => (
              <li key={entry.id}>
                {entry.commandSent} • {entry.success ? 'Delivered' : 'Pending'} •{' '}
                {new Date(entry.timestamp).toLocaleTimeString()}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="controls-panel">
        <div className="controls-grid">
          <button type="button" className="control-btn" onClick={() => void sendCommand('FORWARD')}>
            FORWARD
          </button>
          <button type="button" className="control-btn" onClick={() => void sendCommand('REVERSE')}>
            REVERSE
          </button>
          <button type="button" className="control-btn" onClick={() => void sendCommand('LEFT')}>
            LEFT
          </button>
          <button type="button" className="control-btn" onClick={() => void sendCommand('RIGHT')}>
            RIGHT
          </button>
          <button type="button" className="control-btn" onClick={() => void sendCommand('LIFT')}>
            LIFT
          </button>
          <button type="button" className="control-btn" onClick={() => void sendCommand('LOWER')}>
            LOWER
          </button>
        </div>
        <button type="button" className="emergency" onClick={() => void sendCommand('STOP')}>
          EMERGENCY STOP
        </button>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}
    </main>
  );
}

export default App;
