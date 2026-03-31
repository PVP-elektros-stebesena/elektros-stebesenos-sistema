import { Badge, Group, Loader, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

const STATION_CODE = 'kauno-ams';
const KAUNAS_METEO_URL =
  import.meta.env.DEV
    ? `/meteo/v1/stations/${STATION_CODE}/observations/latest`
    : `https://api.meteo.lt/v1/stations/${STATION_CODE}/observations/latest`;

interface MeteoObservation {
  observationTimeUtc: string;
  airTemperature: number;
}

interface MeteoLatestResponse {
  observations: MeteoObservation[];
}

async function fetchKaunasTemperature(): Promise<MeteoObservation | null> {
  const response = await fetch(KAUNAS_METEO_URL);

  if (!response.ok) {
    throw new Error(`Meteo request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as MeteoLatestResponse;

  if (!payload.observations.length) {
    return null;
  }

  return payload.observations[payload.observations.length - 1];
}

export function WeatherTemperature() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['weather', 'kaunas-temperature'],
    queryFn: fetchKaunasTemperature,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const temperatureLabel = data ? `${data.airTemperature.toFixed(1)} C` : '-- C';

  return (
    <Badge
      variant="filled"
      radius="xl"
      size="lg"
      style={{
        backgroundColor: '#3E3E3E',
        color: '#EBEBEB',
        border: '1px solid #656565',
      }}
    >
      <Group gap={6} wrap="nowrap">
        {isPending && <Loader size={10} color="#FFCC59" />}
        <Text size="xs" fw={500} c={isError ? 'danger.4' : 'dark.0'}>
          Kaunas {temperatureLabel}
        </Text>
      </Group>
    </Badge>
  );
}