import { useEffect, useState } from 'react';
import { Alert, Card, Loader, Stack, Table, Text } from '@mantine/core';
import type { LiveData } from '../types/energy';

function KeyValueTable<T extends object>({ data }: { data: T }) {
  const rows = Object.entries(data).map(([key, value]) => (
    <Table.Tr key={key}>
      <Table.Td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
        <Text size="sm" fw={600}>{key}</Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" style={{ wordBreak: 'break-all' }}>
          {value instanceof Date ? value.toISOString() : String(value ?? '')}
        </Text>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Table.ScrollContainer minWidth={700}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

export function CurrentDataPage() {
  const [data, setData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/live/raw');

        const text = await response.text();

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${text}`);
        }

        const result = JSON.parse(text) as LiveData;

        if (active) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadData();
    const interval = setInterval(loadData, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <Stack p="lg" gap="md">
      <Card p="md">
        <Text fw={700} mb="sm">Raw fields</Text>

        {loading && <Loader size="sm" />}
        {error && <Alert color="red" title="Failed to load data">{error}</Alert>}
        {data && <KeyValueTable data={data} />}
      </Card>
    </Stack>
  );
}