import { Badge, Card, RingProgress, Stack, Text } from '@mantine/core';

interface CapacityUtilizationGaugeProps {
  currentPowerKw: number | null;
  capacityKw: number | null;
  title?: string;
}

function formatKw(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(2)} kW`;
}

function getUtilizationPercent(currentPowerKw: number | null, capacityKw: number | null): number | null {
  if (currentPowerKw == null || capacityKw == null || capacityKw <= 0) return null;
  return (currentPowerKw / capacityKw) * 100;
}

function getGaugeColor(utilizationPercent: number | null): string {
  if (utilizationPercent == null) return '#6B7280';
  if (utilizationPercent > 95) return '#DB3C3C';
  if (utilizationPercent > 80) return '#FFCC59';
  return '#4ADE80';
}

function getStatusLabel(utilizationPercent: number | null): string {
  if (utilizationPercent == null) return 'No data';
  if (utilizationPercent > 95) return 'Near breaker limit';
  if (utilizationPercent > 80) return 'Elevated usage';
  return 'Healthy load';
}

export function CapacityUtilizationGauge({
  currentPowerKw,
  capacityKw,
  title = 'Capacity utilization',
}: CapacityUtilizationGaugeProps) {
  const utilizationPercent = getUtilizationPercent(currentPowerKw, capacityKw);
  const displayPercent = utilizationPercent == null ? null : Math.max(0, utilizationPercent);
  const ringValue = displayPercent == null ? 0 : Math.min(displayPercent, 100);
  const color = getGaugeColor(displayPercent);
  const status = getStatusLabel(displayPercent);

  return (
    <Card p="md" radius="md" withBorder>
      <Stack align="center" gap="xs">
        <Text fw={700}>{title}</Text>

        <RingProgress
          size={180}
          thickness={16}
          roundCaps
          sections={[{ value: ringValue, color }]}
          label={(
            <Stack gap={0} align="center">
              <Text fw={800} fz={28} lh={1} c="dark.0">
                {displayPercent == null ? '—' : `${Math.round(displayPercent)}%`}
              </Text>
              <Text size="xs" c="dimmed">
                utilization
              </Text>
            </Stack>
          )}
        />

        <Badge color={displayPercent != null && displayPercent > 95 ? 'red' : displayPercent != null && displayPercent > 80 ? 'yellow' : 'green'} variant="light">
          {status}
        </Badge>

        <Text size="sm" ta="center">
          {formatKw(currentPowerKw)} / {formatKw(capacityKw)}
        </Text>

        <Text size="xs" c="dimmed" ta="center">
          Shows how close current load is to the configured main breaker capacity.
        </Text>
      </Stack>
    </Card>
  );
}