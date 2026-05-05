import { useState } from 'react';
import { MantineProvider, Box, Burger, Drawer, Flex, Group, Text, Tooltip, ActionIcon } from '@mantine/core';
import '@mantine/core/styles.css';
import { theme } from '../components/theme';
import { Navbar } from '../components/navbar';
import { CurrentDataPage } from '../pages/currentDataPage';
import { VoltagePage } from '../pages/voltagePage';
import { PowerPage } from '../pages/powerPage';
import { SettingsPage } from '../pages/settingsPage';
import { ReportsPage } from '../pages/reportsPage';
import { BillingPage } from '../pages/billingPage';
import { ProfilePage } from '../pages/profilePage';
import type { Page } from '../types/energy';
import { I18nProvider } from '../i18n/i18n';
import { AuthGate } from '../pages/AuthGate';
import { useDisclosure } from '@mantine/hooks';
import { WeatherTemperature } from '../components/weather-temperature';

function IconLogout({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 8l4 4-4 4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 12H9" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>('voltage');
  const [mobileNavOpened, { toggle: toggleMobileNav, close: closeMobileNav }] = useDisclosure(false);
  const [desktopNavHidden, setDesktopNavHidden] = useState(false);

  return (
    <I18nProvider>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <AuthGate>
          {({ user, authDisabled, onLogout, onUserUpdate }) => (
            <Box mih="100vh">
              <Drawer
                opened={mobileNavOpened}
                onClose={closeMobileNav}
                hiddenFrom="md"
                size="xs"
                padding={0}
                withCloseButton={false}
              >
                <Navbar
                  page={page}
                  onNavigate={(nextPage) => {
                    setPage(nextPage)
                    closeMobileNav()
                  }}
                />
              </Drawer>

              <Flex mih="100vh" wrap="nowrap">
                {!desktopNavHidden && (
                  <Box
                    visibleFrom="md"
                    w={260}
                    style={{
                      borderRight: '1px solid var(--mantine-color-dark-6)',
                      position: 'sticky',
                      top: 0,
                      height: '100vh',
                      alignSelf: 'flex-start',
                    }}
                  >
                    <Navbar
                      page={page}
                      onNavigate={setPage}
                      onHide={() => setDesktopNavHidden(true)}
                    />
                  </Box>
                )}

                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Flex
                    visibleFrom="md"
                    align="center"
                    justify="space-between"
                    p="sm"
                    style={{ borderBottom: '1px solid var(--mantine-color-dark-6)' }}
                  >
                    <Group gap="sm" wrap="nowrap">
                      {desktopNavHidden && (
                        <Burger
                          opened={false}
                          onClick={() => setDesktopNavHidden(false)}
                          aria-label="Show navigation"
                          size="sm"
                        />
                      )}
                      <Text fw={500} c="dark.0">
                        P1 Monitor
                      </Text>
                    </Group>

                    <Group gap="xs" wrap="nowrap">
                      <WeatherTemperature />
                      <Text c="dimmed" size="sm" maw={180} truncate>
                        {user.email}
                      </Text>
                      {!authDisabled && (
                        <Tooltip label="Log out">
                          <ActionIcon
                            aria-label="Log out"
                            variant="subtle"
                            color="gray"
                            onClick={onLogout}
                          >
                            <IconLogout size={19} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Flex>

                  <Flex
                    hiddenFrom="md"
                    align="center"
                    justify="space-between"
                    p="sm"
                    style={{ borderBottom: '1px solid var(--mantine-color-dark-6)' }}
                  >
                    <Group gap="sm" wrap="nowrap">
                      <Burger
                        opened={mobileNavOpened}
                        onClick={toggleMobileNav}
                        aria-label="Toggle navigation"
                        size="sm"
                      />
                      <Text fw={500} c="dark.0">
                        P1 Monitor
                      </Text>
                    </Group>

                    <Group gap="xs" wrap="nowrap">
                      <WeatherTemperature />
                      {!authDisabled && (
                        <Tooltip label="Log out">
                          <ActionIcon
                            aria-label="Log out"
                            variant="subtle"
                            color="gray"
                            onClick={onLogout}
                          >
                            <IconLogout size={19} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Flex>

                  <Box component="main" p="md">
                    <Box display={page === 'currentData' ? undefined : 'none'}><CurrentDataPage /></Box>
                    <Box display={page === 'voltage' ? undefined : 'none'}><VoltagePage /></Box>
                    <Box display={page === 'power' ? undefined : 'none'}><PowerPage /></Box>
                    <Box display={page === 'reports' ? undefined : 'none'}><ReportsPage /></Box>
                    <Box display={page === 'billing' ? undefined : 'none'}><BillingPage /></Box>
                    <Box display={page === 'settings' ? undefined : 'none'}><SettingsPage /></Box>
                  </Box>
                </Box>
              </Flex>
            </Box>
          )}
        </AuthGate>
      </MantineProvider>
    </I18nProvider>
  );
}
