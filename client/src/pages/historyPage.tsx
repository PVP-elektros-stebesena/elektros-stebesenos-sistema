import { Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { DAYS_30 } from '../data/mockData';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card p="md">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={800} size="lg">{value}</Text>
    </Card>
  );
}

export function HistoryPage() {
  const totImp = DAYS_30.reduce((s, d) => s + d.import, 0);
  const totExp = DAYS_30.reduce((s, d) => s + d.export, 0);
  const totGas = DAYS_30.reduce((s, d) => s + d.gas, 0);
  const totCost = DAYS_30.reduce((s, d) => s + d.cost, 0);

  return (
    <Stack p="lg" gap="md" style={{ width: '100%' }}>
      <SimpleGrid cols={{ base: 1, sm: 4 }}>
        <Stat label="30d Import" value={`${totImp.toFixed(1)} kWh`} />
        <Stat label="30d Export" value={`${totExp.toFixed(1)} kWh`} />
        <Stat label="30d Gas" value={`${totGas.toFixed(1)} m³`} />
        <Stat label="30d Cost" value={`€${totCost.toFixed(2)}`} />
      </SimpleGrid>

      <Card p="md">
        <Group justify="space-between" mb="sm">
          <Text fw={700}>Daily energy (30 days)</Text>
          <Text size="sm" c="dimmed">Import vs Export</Text>
        </Group>

        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={DAYS_30} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" interval={3} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="import" fill="#4dabf7" name="Import" />
            <Bar dataKey="export" fill="#51cf66" name="Export" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </Stack>
  );
}