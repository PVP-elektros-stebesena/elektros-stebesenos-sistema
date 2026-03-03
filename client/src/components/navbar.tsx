"use client"

import { Group, UnstyledButton, Text, ActionIcon, Box } from "@mantine/core"
import type { Page } from '../types/energy';

const navItems: { label: string; page: Page }[] = [
  { label: "Dashboard", page: "dashboard" },
  { label: "History", page: "history" },
  { label: "Settings", page: "settings" },
]

interface NavbarProps {
  page: Page;
  onNavigate: (page: Page) => void;
  connected?: boolean;
}

export function Navbar({ page, onNavigate }: NavbarProps) {
  return (
    <Box
      px="lg"
      py="sm"
      mx="md"
      mt="md"
      style={{
        backgroundColor: "#353535",
        borderRadius: "9999px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Group gap="sm">
        <Box
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: "#F5A623",
          }}
        />
        <Text fw={500} size="lg" c="#E8E0D0">
          P1 Monitor
        </Text>
      </Group>

      <Group
        gap={4}
        p={4}
        style={{
          backgroundColor: "#404040",
          borderRadius: "9999px",
        }}
      >
        {navItems.map((item) => (
          <UnstyledButton
            key={item.label}
            onClick={() => onNavigate(item.page)}
            px="lg"
            py={8}
            style={{
              borderRadius: "9999px",
              backgroundColor: page === item.page ? "#E8E0D0" : "transparent",
              color: page === item.page ? "#2B2B2B" : "#999999",
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

      <Group gap="xs">
        <ActionIcon
          variant="filled"
          size="lg"
          radius="xl"
          style={{
            backgroundColor: "#404040",
            color: "#E8E0D0",
          }}
          aria-label="Notifications"
        >
        </ActionIcon>
        <ActionIcon
          variant="outline"
          size="lg"
          radius="xl"
          style={{
            borderColor: "#4A4A4A",
            color: "#E8E0D0",
            backgroundColor: "transparent",
          }}
          aria-label="Notification preferences"
        >
        </ActionIcon>
      </Group>
    </Box>
  )
}
