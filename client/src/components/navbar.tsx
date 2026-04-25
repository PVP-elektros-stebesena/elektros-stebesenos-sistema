import { ActionIcon, Group, Tooltip, UnstyledButton, Text, Flex, Box, Divider, Stack } from "@mantine/core"
import type { Page } from '../types/energy';
import { useI18n } from '../i18n/i18n';
import { WeatherTemperature } from './weather-temperature';


function IconBolt({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function IconLogout({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 8l4 4-4 4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 12H9" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconMenu({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7h16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 12h16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 17h16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}



interface NavbarProps {
  page: Page;
  onNavigate: (page: Page) => void;
  connected?: boolean;
  userEmail?: string;
  onLogout?: () => void | Promise<void>;
  onHide?: () => void;
}

export function Navbar({ page, onNavigate, userEmail, onLogout, onHide }: NavbarProps) {
  const { t } = useI18n()

  const navItems: { label: string; page: Page }[] = [
    { label: t('nav.voltage'), page: 'voltage' },
    { label: t('nav.power'), page: 'power' },
    { label: t('nav.reports'), page: 'reports' },
    { label: t('nav.currentData'), page: 'currentData' },
    { label: t('nav.settings'), page: 'settings' },
  ]

  const logo = (
    <Group gap="sm">
      <Box
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          backgroundColor: "#FFCC59",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconBolt size={18} color="#000000" />
      </Box>
      <Text fw={500} size="xl" c="white">
        P1 Monitor
      </Text>
    </Group>
  );




  return (
    <Box
      component="nav"
      p="md"
      h="100vh"
      style={{
        width: 280,
        backgroundColor: "#2F2F2F",
        borderRight: "1px solid #515151",
        position: "sticky",
        top: 0,
        overflow: "auto",
      }}
    >
      <Flex direction="column" h="100%" gap="md">
        <Group justify="space-between" align="center">
          {logo}
          {onHide && (
            <Tooltip label="Hide menu">
              <ActionIcon aria-label="Hide menu" variant="subtle" color="gray" onClick={onHide}>
                <IconMenu size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>

        <Divider color="#515151" />

        <Stack gap={6} style={{ flex: 1 }}>
          {navItems.map((item) => (
            <UnstyledButton
              key={item.label}
              onClick={() => onNavigate(item.page)}
              px="md"
              py={10}
              style={{
                width: '100%',
                borderRadius: 12,
                backgroundColor: page === item.page ? "#FFCC59" : "transparent",
                color: page === item.page ? "#000000" : "#EBEBEB",
                fontWeight: 600,
                fontSize: "14px",
                transition: "all 150ms ease",
                cursor: "pointer",
              }}
            >
              {item.label}
            </UnstyledButton>
          ))}
        </Stack>

        <Divider color="#515151" />

        <Group gap="xs" justify="space-between" wrap="nowrap">
          <WeatherTemperature />
          <Box style={{ flex: 1, minWidth: 0 }}>
            {userEmail && (
              <Text c="dimmed" size="sm" truncate>
                {userEmail}
              </Text>
            )}
          </Box>
          {onLogout && (
            <Tooltip label={`Log out${userEmail ? ` ${userEmail}` : ''}`}>
              <ActionIcon aria-label="Log out" variant="subtle" color="gray" onClick={onLogout}>
                <IconLogout size={19} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Flex>
    </Box>
  );
}
