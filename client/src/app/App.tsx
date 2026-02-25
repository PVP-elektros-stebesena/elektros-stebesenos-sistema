import { useState } from 'react';
import { MantineProvider, Box } from '@mantine/core';
import '@mantine/core/styles.css';
import { theme } from '../components/theme';
import { Navbar } from '../components/navbar';
import { DashboardPage } from '../pages/dashboardPage';
import { HistoryPage } from '../pages/historyPage';
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
          {page === 'dashboard' && <DashboardPage data={data} />}
          {page === 'history' && <HistoryPage />}
          {page === 'settings' && <SettingsPage />}
        </Box>
      </Box>
    </MantineProvider>
  );
}