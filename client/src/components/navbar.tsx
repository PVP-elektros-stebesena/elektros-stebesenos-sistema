import { Group, UnstyledButton, Text, Flex, Box } from "@mantine/core"
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



interface NavbarProps {
  page: Page;
  onNavigate: (page: Page) => void;
  connected?: boolean;
}

export function Navbar({ page, onNavigate }: NavbarProps) {
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
      px={{ base: 'xs', sm: 'lg' }}
      py="sm"
      mx={{ base: 0, sm: 'md' }}
      mt={{ base: 0, sm: 'md' }}
    >
      <Flex 
        display={{ base: 'flex', md: 'none' }} 
        align="center" 
        justify="space-between"
        mb="md"
      >
        {logo}
        <WeatherTemperature />
      </Flex>

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
          <WeatherTemperature />
        </Box>
      </Flex>
    </Box>
  );
}
