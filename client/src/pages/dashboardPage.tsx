import { Card, SimpleGrid, Stack, Table, Text, Group, Divider } from '@mantine/core';
import type { LiveData } from '../types/energy';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card p="md">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={800} size="lg">{value}</Text>
    </Card>
  );
}

function KeyValueTable({ data }: { data: Record<string, unknown> }) {
  const rows = Object.entries(data).map(([k, v]) => (
    <Table.Tr key={k}>
      <Table.Td style={{ whiteSpace: 'nowrap' }}>
        <Text size="sm" fw={600}>{k}</Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm">
          {v instanceof Date ? v.toISOString() : String(v)}
        </Text>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Table striped highlightOnHover withTableBorder>
      <Table.Tbody>{rows}</Table.Tbody>
    </Table>
  );
}

export function DashboardPage({ data }: { data: LiveData }) {
  const totalImport = data.total_t1_import + data.total_t2_import;
  const totalExport = data.total_t1_export + data.total_t2_export;

  return (
    <Stack p="lg" gap="md">
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Stat label="Power delivered" value={`${data.power_delivered.toFixed(3)} kW`} />
        <Stat label="Power returned" value={`${data.power_returned.toFixed(3)} kW`} />
        <Stat label="Gas flow" value={`${data.gas_flow.toFixed(3)} m³/h`} />
      </SimpleGrid>

      <Card p="md">
        <Group justify="space-between" mb="sm">
          <Text fw={800}>Per phase</Text>
          <Text size="sm" c="dimmed">
            Tariff: {data.tariff} • {data.timestamp.toLocaleString()}
          </Text>
        </Group>

        <Table withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Phase</Table.Th>
              <Table.Th>Voltage (V)</Table.Th>
              <Table.Th>Current (A)</Table.Th>
              <Table.Th>Power (kW)</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>L1</Table.Td>
              <Table.Td>{data.voltage_l1}</Table.Td>
              <Table.Td>{data.current_l1}</Table.Td>
              <Table.Td>{data.power_l1.toFixed(3)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>L2</Table.Td>
              <Table.Td>{data.voltage_l2}</Table.Td>
              <Table.Td>{data.current_l2}</Table.Td>
              <Table.Td>{data.power_l2.toFixed(3)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>L3</Table.Td>
              <Table.Td>{data.voltage_l3}</Table.Td>
              <Table.Td>{data.current_l3}</Table.Td>
              <Table.Td>{data.power_l3.toFixed(3)}</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Card>

      <SimpleGrid cols={{ base: 1, sm: 4 }}>
        <Stat label="Import T1" value={`${data.total_t1_import.toFixed(3)} kWh`} />
        <Stat label="Import T2" value={`${data.total_t2_import.toFixed(3)} kWh`} />
        <Stat label="Export T1" value={`${data.total_t1_export.toFixed(3)} kWh`} />
        <Stat label="Export T2" value={`${data.total_t2_export.toFixed(3)} kWh`} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Stat label="Total import" value={`${totalImport.toFixed(3)} kWh`} />
        <Stat label="Total export" value={`${totalExport.toFixed(3)} kWh`} />
        <Stat label="Total gas" value={`${data.total_gas.toFixed(3)} m³`} />
      </SimpleGrid>

      <Divider />

      <Card p="md">
        <Text fw={800} mb="sm">All raw fields</Text>
        <KeyValueTable data={data as unknown as Record<string, unknown>} />
      </Card>
    </Stack>
  );
}