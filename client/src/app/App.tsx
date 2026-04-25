import { useState } from 'react';
import { MantineProvider, Box, ActionIcon, Tooltip } from '@mantine/core';
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

function IconMenu({ size = 20, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7h16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 12h16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 17h16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>('voltage');
  const [navOpen, setNavOpen] = useState(true);

  return (
    <I18nProvider>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <AuthGate>
          {({ user, onLogout }) => (
            <Box mih="100vh" style={{ display: 'flex' }}>
              {navOpen && (
                <Navbar
                  page={page}
                  onNavigate={setPage}
                  connected
                  userEmail={user.email}
                  onLogout={onLogout}
                  onHide={() => setNavOpen(false)}
                />
              )}

              <Box style={{ flex: 1, position: 'relative' }}>
                {!navOpen && (
                  <Tooltip label="Show menu">
                    <ActionIcon
                      aria-label="Show menu"
                      variant="transparent"
                      color="gray"
                      onClick={() => setNavOpen(true)}
                      style={{ position: 'fixed', top: 16, left: 16, zIndex: 1000 }}
                    >
                      <IconMenu size={18} />
                    </ActionIcon>
                  </Tooltip>
                )}

                <Box component="main" p="md" style={!navOpen ? { paddingTop: 64, paddingLeft: 64 } : undefined}>
                  <Box display={page === 'currentData' ? undefined : 'none'}><CurrentDataPage /></Box>
                  <Box display={page === 'voltage' ? undefined : 'none'}><VoltagePage /></Box>
                  <Box display={page === 'power' ? undefined : 'none'}><PowerPage /></Box>
                  <Box display={page === 'reports' ? undefined : 'none'}><ReportsPage /></Box>
                  <Box display={page === 'settings' ? undefined : 'none'}><SettingsPage /></Box>
                </Box>
              </Box>
            </Box>
          )}
        </AuthGate>
      </MantineProvider>
    </I18nProvider>
  );
}
