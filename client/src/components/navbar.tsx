import { ActionIcon, Box, Group, ScrollArea, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core"
import type { Page } from '../types/energy';
import { useI18n } from '../i18n/i18n';


function IconBolt({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function IconUser({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="8" r="4" stroke={color} strokeWidth="1.8" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconLogout({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 6l-6 6 6 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}



interface NavbarProps {
  page: Page;
  onNavigate: (page: Page) => void;
  connected?: boolean;
  userEmail?: string;
  onLogout?: () => void | Promise<void>;
  onProfileClick?: () => void;
}

export function Navbar({ page, onNavigate, userEmail, onLogout, onProfileClick }: NavbarProps) {
  const { t, language, setLanguage } = useI18n()

  const langToggle = (
    <Group gap={2} style={{ backgroundColor: '#515151', borderRadius: 20, padding: '3px' }}>
      {(['en', 'lt'] as const).map((lang) => (
        <UnstyledButton
          key={lang}
          onClick={() => setLanguage(lang)}
          px={8}
          py={4}
          style={{
            borderRadius: 16,
            backgroundColor: language === lang ? '#FFCC59' : 'transparent',
            color: language === lang ? '#000000' : '#EBEBEB',
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1,
            transition: 'all 150ms ease',
          }}
        >
          {lang.toUpperCase()}
        </UnstyledButton>
      ))}
    </Group>
  )

  const navItems: { label: string; page: Page }[] = [
    { label: t('nav.voltage'), page: 'voltage' },
    { label: t('nav.power'), page: 'power' },
    { label: t('nav.reports'), page: 'reports' },
    { label: t('nav.billing'), page: 'billing' },
    { label: t('nav.currentData'), page: 'currentData' },
    { label: t('nav.settings'), page: 'settings' },
  ]

  return (
    <Box
      h="100%"
      bg="dark.7"
      p="md"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--mantine-spacing-md)',
      }}
    >
      <Flex 
        display={{ base: 'flex', md: 'none' }} 
        align="center" 
        justify="space-between"
        mb="md"
      >
        {logo}
        <Group gap="xs">
          <WeatherTemperature />
          {langToggle}
          {onProfileClick && (
            <Tooltip label="Profile">
              <ActionIcon aria-label="Profile" variant="subtle" color="gray" onClick={onProfileClick}>
                <IconUser size={19} />
              </ActionIcon>
            </Tooltip>
          )}
          {onLogout && (
            <Tooltip label={`Log out${userEmail ? ` ${userEmail}` : ''}`}>
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

        {onHide && (
          <Tooltip label="Hide menu">
            <ActionIcon
              aria-label="Hide menu"
              variant="subtle"
              color="gray"
              onClick={onHide}
            >
              <IconCollapse size={20} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>

      <ScrollArea type="auto" style={{ flex: 1 }}>
        <Stack gap={6}>
          {navItems.map((item) => {
            const active = page === item.page
            return (
              <UnstyledButton
                key={item.page}
                onClick={() => onNavigate(item.page)}
                px="md"
                py={10}
                style={{
                  borderRadius: '999px',
                  backgroundColor: active ? 'var(--mantine-color-primary-5)' : 'transparent',
                  color: active ? 'var(--mantine-color-black)' : 'var(--mantine-color-dark-0)',
                  fontWeight: 500,
                  fontSize: '14px',
                  transition: 'background-color 150ms ease, color 150ms ease',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (active) return
                  e.currentTarget.style.backgroundColor = 'var(--mantine-color-dark-6)'
                }}
                onMouseLeave={(e) => {
                  if (active) return
                  e.currentTarget.style.backgroundColor = 'transparent'
                }}
              >
                {item.label}
              </UnstyledButton>
            )
          })}
        </Stack>
      </ScrollArea>

        <Box
          display={{ base: 'none', md: 'flex' }}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <Group gap="xs" justify="flex-end">
            <WeatherTemperature />
            {langToggle}
            {userEmail && (
              <UnstyledButton
                onClick={onProfileClick}
                style={{ cursor: onProfileClick ? 'pointer' : 'default' }}
              >
                <Text c="dimmed" size="sm" maw={180} truncate>
                  {userEmail}
                </Text>
              </UnstyledButton>
            )}
            {onProfileClick && (
              <Tooltip label="Profile">
                <ActionIcon aria-label="Profile" variant="subtle" color="gray" onClick={onProfileClick}>
                  <IconUser size={19} />
                </ActionIcon>
              </Tooltip>
            )}
            {onLogout && (
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
        </Box>
      </Flex>
    </Box>
  )
}
