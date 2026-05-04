import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert, Box, Button, Group, Loader, Paper,
  PasswordInput, SimpleGrid, Skeleton, Stack, Text, TextInput, Title,
} from '@mantine/core';
import { apiFetch, apiPatch, getApiErrorMessage } from '../services/apiClient';
import { useI18n } from '../i18n/i18n';

interface AuthUser {
  id: number;
  email: string;
  username: string | null;
  displayName: string | null;
}

interface ProfileStats {
  memberSince: string | null;
  lastLoginAt: string | null;
  deviceCount: number;
  totalReadings: number;
  totalEnergyConsumedKwh: number | null;
  totalEnergyReturnedKwh: number | null;
  totalAnomalies: number;
  activeAnomalies: number;
  voltageAnomalies: number;
  powerAnomalies: number;
  totalReports: number;
  renterCount: number;
  oldestReadingAt: string | null;
  newestReadingAt: string | null;
}

interface ProfilePageProps {
  user: AuthUser;
  onUserUpdate: (user: AuthUser) => void;
  authDisabled: boolean;
}

function fmtDate(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtEnergy(kwh: number | null): string {
  if (kwh === null) return '—';
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
  return `${kwh.toFixed(1)} kWh`;
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Paper withBorder p="md" radius="md" bg="#2F2F2F">
      <Text size="xs" c="dimmed" mb={4}>{label}</Text>
      <Text fw={700} size="lg" lh={1.2}>{value}</Text>
      {sub && <Text size="xs" c="dimmed" mt={4}>{sub}</Text>}
    </Paper>
  );
}

export function ProfilePage({ user, onUserUpdate, authDisabled }: ProfilePageProps) {
  const { t } = useI18n();

  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [username, setUsername] = useState(user.username ?? '');
  const [email, setEmail] = useState(user.email);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ProfileStats>('/api/auth/me/stats')
      .then(setStats)
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  const initials = (user.displayName || user.email).slice(0, 2).toUpperCase();

  const handleProfileSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileLoading(true);
    setProfileSuccess(false);
    setProfileError(null);

    try {
      const result = await apiPatch<{ user: AuthUser }>('/api/auth/me', {
        displayName: displayName.trim() || null,
        email: email.trim(),
        username: username.trim() || null,
      });
      onUserUpdate(result.user);
      setDisplayName(result.user.displayName ?? '');
      setUsername(result.user.username ?? '');
      setEmail(result.user.email);
      setProfileSuccess(true);
    } catch (err) {
      setProfileError(getApiErrorMessage(err, t('profile.errorUpdate')));
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordError(t('profile.errorPasswordMatch'));
      return;
    }
    setPasswordLoading(true);
    setPasswordSuccess(false);
    setPasswordError(null);

    try {
      await apiPatch<void>('/api/auth/me/password', { currentPassword, newPassword });
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(getApiErrorMessage(err, t('profile.errorPasswordChange')));
    } finally {
      setPasswordLoading(false);
    }
  };

  const dataRangeSub = stats?.oldestReadingAt && stats?.newestReadingAt
    ? `${fmtDate(stats.oldestReadingAt, '—')} – ${fmtDate(stats.newestReadingAt, '—')}`
    : undefined;

  return (
    <Box display="flex" style={{ justifyContent: 'center', width: '100%', paddingTop: '20px' }}>
      <Stack maw={680} w="100%" gap="xl">

        {/* ── Account header ── */}
        <Group gap="md">
          <Box
            style={{
              width: 56, height: 56, borderRadius: '50%',
              backgroundColor: '#FFCC59',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <Text fw={700} size="xl" c="#000000">{initials}</Text>
          </Box>
          <Stack gap={2}>
            <Title order={2} c="white">{user.displayName || user.email}</Title>
            {user.displayName && <Text c="dimmed" size="sm">{user.email}</Text>}
          </Stack>
        </Group>

        {/* ── Stats grid ── */}
        <Stack gap="xs">
          <Text fw={600} size="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.05em' }}>
            {t('profile.stats')}
          </Text>

          {statsLoading ? (
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} height={72} radius="md" />
              ))}
            </SimpleGrid>
          ) : (
            <>
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                <StatCard
                  label={t('profile.memberSince')}
                  value={fmtDate(stats?.memberSince, '—')}
                />
                <StatCard
                  label={t('profile.lastLogin')}
                  value={fmtDate(stats?.lastLoginAt, t('profile.never'))}
                />
                <StatCard
                  label={t('profile.devices')}
                  value={stats?.deviceCount ?? '—'}
                />
                <StatCard
                  label={t('profile.totalReadings')}
                  value={stats ? stats.totalReadings.toLocaleString() : '—'}
                />
              </SimpleGrid>

              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                <StatCard
                  label={t('profile.energyConsumed')}
                  value={fmtEnergy(stats?.totalEnergyConsumedKwh ?? null)}
                  sub={dataRangeSub}
                />
                <StatCard
                  label={t('profile.energyReturned')}
                  value={fmtEnergy(stats?.totalEnergyReturnedKwh ?? null)}
                />
                <StatCard
                  label={t('profile.totalAnomalies')}
                  value={stats ? stats.totalAnomalies.toLocaleString() : '—'}
                  sub={stats && stats.activeAnomalies > 0 ? `${stats.activeAnomalies} active` : undefined}
                />
                <StatCard
                  label={t('profile.reports')}
                  value={stats ? stats.totalReports.toLocaleString() : '—'}
                  sub={stats && stats.renterCount > 0 ? `${stats.renterCount} ${t('profile.renters').toLowerCase()}` : undefined}
                />
              </SimpleGrid>
            </>
          )}
        </Stack>

        {/* ── Edit profile ── */}
        <Paper withBorder p="xl" radius="md" bg="#2F2F2F">
          <form onSubmit={handleProfileSave}>
            <Stack gap="md">
              <Title order={4} c="white">{t('profile.account')}</Title>
              <TextInput
                label={t('profile.displayName')}
                value={displayName}
                onChange={(e) => { setDisplayName(e.currentTarget.value); setProfileSuccess(false); }}
                placeholder="Your display name"
              />
              <TextInput
                label={t('profile.username')}
                value={username}
                onChange={(e) => { setUsername(e.currentTarget.value); setProfileSuccess(false); }}
                placeholder="username"
              />
              <TextInput
                label={t('profile.email')}
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.currentTarget.value); setProfileSuccess(false); }}
                required
              />
              {profileSuccess && (
                <Alert color="green" variant="light">{t('profile.successUpdated')}</Alert>
              )}
              {profileError && (
                <Alert color="red" variant="light">{profileError}</Alert>
              )}
              <Button type="submit" loading={profileLoading} color="yellow" leftSection={profileLoading ? <Loader size={14} color="dark" /> : undefined}>
                {t('profile.saveChanges')}
              </Button>
            </Stack>
          </form>
        </Paper>

        {/* ── Change password ── */}
        {!authDisabled && (
          <Paper withBorder p="xl" radius="md" bg="#2F2F2F">
            <form onSubmit={handlePasswordChange}>
              <Stack gap="md">
                <Title order={4} c="white">{t('profile.changePassword')}</Title>
                <PasswordInput
                  label={t('profile.currentPassword')}
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.currentTarget.value); setPasswordSuccess(false); }}
                  required
                />
                <PasswordInput
                  label={t('profile.newPassword')}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.currentTarget.value); setPasswordSuccess(false); }}
                  minLength={8}
                  required
                />
                <PasswordInput
                  label={t('profile.confirmPassword')}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.currentTarget.value); setPasswordSuccess(false); }}
                  required
                />
                {passwordSuccess && (
                  <Alert color="green" variant="light">{t('profile.successPasswordChanged')}</Alert>
                )}
                {passwordError && (
                  <Alert color="red" variant="light">{passwordError}</Alert>
                )}
                <Button type="submit" loading={passwordLoading} color="yellow">
                  {t('profile.changePassword')}
                </Button>
              </Stack>
            </form>
          </Paper>
        )}

      </Stack>
    </Box>
  );
}
