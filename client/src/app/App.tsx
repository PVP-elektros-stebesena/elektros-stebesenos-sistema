import { useState } from 'react';
import { MantineProvider, Box } from '@mantine/core';
import '@mantine/core/styles.css';
import { theme } from '../components/theme';
import { Navbar } from '../components/navbar';
import { CurrentDataPage } from '../pages/currentDataPage';
import { VoltagePage } from '../pages/voltagePage';
import { PowerPage } from '../pages/powerPage';
import { SettingsPage } from '../pages/settingsPage';
import { ReportsPage } from '../pages/reportsPage';
import type { Page } from '../types/energy';
import { I18nProvider } from '../i18n/i18n';
import { AuthGate } from '../pages/AuthGate';

export default function App() {
  const [page, setPage] = useState<Page>('voltage');

  return (
    <I18nProvider>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <AuthGate>
          {({ user, authDisabled, onLogout }) => (
            <Box mih="100vh">
              <Navbar
                page={page}
                onNavigate={setPage}
                connected
                userEmail={user.email}
                onLogout={authDisabled ? undefined : onLogout}
              />

              <Box component="main" p="md">
                <Box display={page === 'currentData' ? undefined : 'none'}><CurrentDataPage /></Box>
                <Box display={page === 'voltage' ? undefined : 'none'}><VoltagePage /></Box>
                <Box display={page === 'power' ? undefined : 'none'}><PowerPage /></Box>
                <Box display={page === 'reports' ? undefined : 'none'}><ReportsPage /></Box>
                <Box display={page === 'settings' ? undefined : 'none'}><SettingsPage /></Box>
              </Box>
            </Box>
          )}
        </AuthGate>
      </MantineProvider>
    </I18nProvider>
  );
}
