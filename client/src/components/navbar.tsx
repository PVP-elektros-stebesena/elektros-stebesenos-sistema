import { Group, UnstyledButton, Text, ActionIcon, Flex, Box } from "@mantine/core"
import type { Page } from '../types/energy';

/* ── Inline SVG icons (no icon library needed) ─────────────── */

function IconBolt({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function IconBell({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IconBellFilled({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

const navItems: { label: string; page: Page }[] = [
  { label: "Dashboard", page: "dashboard" },
  { label: "Voltage", page: "voltage" },
  { label: "Reports", page: "reports" },
  { label: "Settings", page: "settings" },
]

interface NavbarProps {
  page: Page;
  onNavigate: (page: Page) => void;
  connected?: boolean;
}

export function Navbar({ page, onNavigate }: NavbarProps) {
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

  const notifications = (
    <Group gap="xs">
      <ActionIcon
        variant="filled"
        size="lg"
        radius="xl"
        style={{
          backgroundColor: "#FFCC59",
          color: "#000000",
        }}
        aria-label="Notifications"
      >
        <IconBellFilled size={18} color="#000000" />
      </ActionIcon>
      <ActionIcon
        variant="outline"
        size="lg"
        radius="xl"
        style={{
          borderColor: "#EBEBEB",
          color: "#EBEBEB",
          backgroundColor: "transparent",
        }}
        aria-label="Notification preferences"
      >
        <IconBell size={18} color="#EBEBEB" />
      </ActionIcon>
    </Group>
  );

  return (
    <Box
      px={{ base: 'xs', sm: 'lg' }}
      py="sm"
      mx={{ base: 0, sm: 'md' }}
      mt={{ base: 0, sm: 'md' }}
    >
      {/* Mobile Top Row: Logo & Icons */}
      <Flex 
        display={{ base: 'flex', md: 'none' }} 
        align="center" 
        justify="space-between"
        mb="md"
      >
        {logo}
        {notifications}
      </Flex>

      {/* Main Nav Row */}
      <Flex
        direction="row"
        align="center"
        justify={{ base: 'center', md: 'space-between' }}
        gap="md"
      >
        <Box display={{ base: 'none', md: 'block' }}>
          {logo}
        </Box>

                <Group
          gap={4}
          p={4}
          justify="center"
          style={{
            backgroundColor: "#515151",
            borderRadius: "34px",
            flexWrap: "wrap",
          }}
        >
          {navItems.map((item) => (
            <UnstyledButton
              key={item.label}
              onClick={() => onNavigate(item.page)}
              px="lg"
              py={8}
              w={{ base: 'calc(50% - 4px)', sm: 'auto' }}
              ta="center"
              style={{
                borderRadius: "44px",
                backgroundColor: page === item.page ? "#FFCC59" : "#515151",
                color: page === item.page ? "#000000" : "#EBEBEB",
                fontWeight: 500,
                fontSize: "14px",
                transition: "all 150ms ease",
                cursor: "pointer",
              }}
            >
              {item.label}
            </UnstyledButton>
          ))}
        </Group>

        <Box display={{ base: 'none', md: 'block' }}>
          {notifications}
        </Box>
      </Flex>
    </Box>
  );
}
