import { Group, Button, Text, Badge } from '@mantine/core';
import type { Page } from '../types/energy';

export function Navbar({
  page,
  onNavigate,
  connected,
}: {
  page: Page;
  onNavigate: (p: Page) => void;
  connected: boolean;
}) {
  return (
    <Group justify="space-between" p="md">
      <Text fw={700}>P1 Monitor</Text>

      <Group gap="xs">
        <Button variant={page === 'dashboard' ? 'filled' : 'subtle'} onClick={() => onNavigate('dashboard')}>
          Dashboard
        </Button>
        <Button variant={page === 'history' ? 'filled' : 'subtle'} onClick={() => onNavigate('history')}>
          History
        </Button>
        <Button variant={page === 'settings' ? 'filled' : 'subtle'} onClick={() => onNavigate('settings')}>
          Settings
        </Button>
      </Group>

      <Badge color={connected ? 'green' : 'red'}>{connected ? 'LIVE' : 'OFFLINE'}</Badge>
    </Group>
  );
}