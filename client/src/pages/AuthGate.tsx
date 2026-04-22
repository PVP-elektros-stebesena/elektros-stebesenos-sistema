import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Center,
  Container,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { apiFetch, apiPost, clearAuthToken, getAuthToken, setAuthToken } from '../services/apiClient';

interface AuthUser {
  id: number;
  email: string;
  username: string | null;
  displayName: string | null;
}

interface AuthResponse {
  token: string;
  user: AuthUser;
  expiresAt: string;
}

interface StatusResponse {
  setupRequired: boolean;
}

interface MeResponse {
  user: AuthUser;
}

interface AuthGateProps {
  children: (auth: { user: AuthUser; onLogout: () => Promise<void> }) => ReactNode;
}

type AuthMode = 'loading' | 'setup' | 'login' | 'authenticated';

export function AuthGate({ children }: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>('loading');
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadAuthState() {
      try {
        const status = await apiFetch<StatusResponse>('/api/auth/status');
        if (cancelled) return;
        setSetupRequired(status.setupRequired);

        if (!getAuthToken()) {
          setMode('login');
          return;
        }

        const me = await apiFetch<MeResponse>('/api/auth/me');
        if (cancelled) return;
        setUser(me.user);
        setMode('authenticated');
      } catch {
        if (cancelled) return;
        clearAuthToken();
        setMode('login');
      }
    }

    loadAuthState();

    return () => {
      cancelled = true;
    };
  }, []);

  const completeAuthentication = (response: AuthResponse) => {
    setAuthToken(response.token);
    setUser(response.user);
    setPassword('');
    setError(null);
    setMode('authenticated');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (mode === 'setup') {
        const response = await apiPost<AuthResponse>('/api/auth/setup', {
          email,
          displayName: displayName.trim() || null,
          password,
        });
        setSetupRequired(false);
        completeAuthentication(response);
      } else {
        const response = await apiPost<AuthResponse>('/api/auth/login', {
          identifier,
          password,
        });
        completeAuthentication(response);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiPost<void>('/api/auth/logout', {});
    } finally {
      clearAuthToken();
      setUser(null);
      setIdentifier('');
      setMode('login');
    }
  };

  if (mode === 'loading') {
    return (
      <Center mih="100vh">
        <Text c="dimmed">Checking session...</Text>
      </Center>
    );
  }

  if (mode === 'authenticated' && user) {
    return children({ user, onLogout: handleLogout });
  }

  const isSetup = mode === 'setup';

  const switchToLogin = () => {
    setMode('login');
    setError(null);
  };

  const switchToSetup = () => {
    setMode('setup');
    setError(null);
  };

  return (
    <Center mih="100vh" px="md">
      <Container size={420} w="100%">
        <Paper withBorder radius="md" p="xl" bg="#2F2F2F">
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <Stack gap={4}>
                <Title order={1} size="h2" c="white">
                  {isSetup ? 'Create admin account' : 'Log in'}
                </Title>
                <Text c="dimmed" size="sm">
                  {isSetup
                    ? 'Create the first account to access P1 Monitor.'
                    : 'Use your email or username to access P1 Monitor.'}
                </Text>
              </Stack>

              {error && (
                <Alert color="red" variant="light">
                  {isSetup ? 'Could not create the account.' : 'Invalid credentials.'}
                </Alert>
              )}

              {isSetup ? (
                <>
                  <TextInput
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    required
                  />
                  <TextInput
                    label="Display name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.currentTarget.value)}
                  />
                </>
              ) : (
                <TextInput
                  label="Email or username"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.currentTarget.value)}
                  required
                />
              )}

              <PasswordInput
                label="Password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                minLength={isSetup ? 8 : 1}
                required
              />

              <Button type="submit" loading={submitting} color="yellow">
                {isSetup ? 'Create account' : 'Log in'}
              </Button>

              {isSetup ? (
                <Button type="button" variant="subtle" color="gray" onClick={switchToLogin}>
                  Already have an account? Log in
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="subtle"
                  color="gray"
                  onClick={switchToSetup}
                  disabled={!setupRequired}
                >
                  {setupRequired
                    ? "Don't have an account? Register"
                    : 'Registration is closed'}
                </Button>
              )}
            </Stack>
          </form>
        </Paper>
      </Container>
    </Center>
  );
}
