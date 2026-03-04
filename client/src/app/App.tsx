import { useState } from 'react';
import { MantineProvider, Box } from '@mantine/core';
import '@mantine/core/styles.css';
import { theme } from '../components/theme';
import { Navbar } from '../components/navbar';
import { DashboardPage } from '../pages/dashboardPage';
import { VoltagePage } from '../pages/voltagePage';
import { SettingsPage } from '../pages/settingsPage';
import { useLiveData } from '../hooks/useLiveData';
import type { Page } from '../types/energy';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const data = useLiveData(2000);

  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Box mih="100vh">
        <Navbar page={page} onNavigate={setPage} connected />

        <Box component="main" p="md">
          <Box display={page === 'dashboard' ? undefined : 'none'}><DashboardPage data={data} /></Box>
          <Box display={page === 'voltage' ? undefined : 'none'}><VoltagePage /></Box>
          <Box display={page === 'settings' ? undefined : 'none'}><SettingsPage /></Box>
        </Box>
      </Box>
    </MantineProvider>
  );
}