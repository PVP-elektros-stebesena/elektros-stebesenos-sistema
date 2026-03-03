import { useEffect, useRef, useState } from 'react';
import { Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { DAYS_30 } from '../data/mockData';
import { useLiveData } from '../hooks/useLiveData';

const MAX_POINTS = 60;

interface VoltagePoint {
  time: string;
  L1: number;
  L2: number;
  L3: number;
}

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

  const live = useLiveData(2000);
  const [voltageHistory, setVoltageHistory] = useState<VoltagePoint[]>([]);
  const prevTs = useRef<Date | null>(null);

  useEffect(() => {
    if (prevTs.current && live.timestamp.getTime() === prevTs.current.getTime()) return;
    prevTs.current = live.timestamp;

    const point: VoltagePoint = {
      time: live.timestamp.toLocaleTimeString(),
      L1: live.voltage_l1,
      L2: live.voltage_l2,
      L3: live.voltage_l3,
    };

    setVoltageHistory(prev => {
      const next = [...prev, point];
      return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
    });
  }, [live]);

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
          <Text fw={700}>Live voltage</Text>
        </Group>

        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={voltageHistory}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
            <YAxis domain={['auto', 'auto']} unit=" V" tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line  dataKey="L1" stroke="#4dabf7" dot={false} strokeWidth={2} name="L1" />
            <Line dataKey="L2" stroke="#51cf66" dot={false} strokeWidth={2} name="L2" />
            <Line  dataKey="L3" stroke="#ff6b6b" dot={false} strokeWidth={2} name="L3" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

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