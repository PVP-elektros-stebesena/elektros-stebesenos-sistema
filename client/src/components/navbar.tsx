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

function IconCollapse({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 6l-6 6 6 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}



interface NavbarProps {
  page: Page;
  onNavigate: (page: Page) => void;
  onHide?: () => void;
}

export function Navbar({ page, onNavigate, onHide }: NavbarProps) {
  const { t } = useI18n()

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
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <Box
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              backgroundColor: 'var(--mantine-color-primary-5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 auto',
            }}
          >
            <IconBolt size={18} color="var(--mantine-color-black)" />
          </Box>
          <Text fw={500} size="lg" c="dark.0" style={{ lineHeight: 1 }}>
            P1 Monitor
          </Text>
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

    </Box>
  )
}
