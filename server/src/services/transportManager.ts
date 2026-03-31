import mqtt from 'mqtt';
import { AnomalyTracker } from './anomalyTracker.js';
import type { DeviceRuntime, RuntimeProcessors } from './devicePollerTypes.js';
import { PowerTracker } from './powerTracker.js';
import { PowerWindowManager } from './powerWindowManager.js';
import { WindowManager } from './windowManager.js';

interface TransportHandlers {
  onReading: (
    deviceId: number,
    raw: Record<string, string>,
    now: Date,
    processors: RuntimeProcessors,
  ) => Promise<void>;
  onDeviceUnreachable: (deviceId: number, endpoint: string, reason: string) => Promise<void>;
  onDeviceRecovered: (deviceId: number, endpoint: string) => Promise<void>;
}

interface StartHttpRuntimeOptions extends TransportHandlers {
  deviceId: number;
  deviceIp: string;
  pollInterval: number;
  processors?: RuntimeProcessors;
}

interface StartMqttRuntimeOptions extends TransportHandlers {
  deviceId: number;
  mqttBroker: string;
  mqttPort?: number | null;
  mqttTopic: string;
  pollInterval: number;
  processors?: RuntimeProcessors;
}

export class TransportManager {
  private fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch) {
    this.fetchFn = fetchFn;
  }

  startHttpRuntime(options: StartHttpRuntimeOptions): DeviceRuntime {
    const processors = this.createProcessors(options.pollInterval, options.processors);

    const timer = setInterval(() => {
      this.pollHttpDevice(options, processors).catch((err) =>
        console.error(`[DevicePoller] Device ${options.deviceId} poll error:`, err),
      );
    }, options.pollInterval * 1000);

    this.pollHttpDevice(options, processors).catch((err) =>
      console.error(`[DevicePoller] Device ${options.deviceId} initial poll error:`, err),
    );

    return {
      deviceId: options.deviceId,
      mode: 'http',
      deviceIp: options.deviceIp,
      pollInterval: options.pollInterval,
      timer,
      ...processors,
    };
  }

  startMqttRuntime(options: StartMqttRuntimeOptions): DeviceRuntime {
    const processors = this.createProcessors(options.pollInterval, options.processors);
    const brokerUrl = this.buildBrokerUrl(options.mqttBroker, options.mqttPort);
    const client = mqtt.connect(brokerUrl);

    client.on('connect', async () => {
      console.log(`[DevicePoller] MQTT connected for device ${options.deviceId} → ${options.mqttTopic}`);
      await options.onDeviceRecovered(options.deviceId, `mqtt:${options.mqttBroker}`);

      client.subscribe(options.mqttTopic, (err) => {
        if (err) {
          console.error(`[DevicePoller] MQTT subscribe failed for device ${options.deviceId}:`, err);
        }
      });
    });

    client.on('message', (_topic, payload) => {
      this.handleMqttMessage(options, payload, processors).catch((err) =>
        console.error(`[DevicePoller] Device ${options.deviceId} MQTT message error:`, err),
      );
    });

    client.on('error', async (err) => {
      console.error(`[DevicePoller] MQTT error for device ${options.deviceId}:`, err);
      await options.onDeviceUnreachable(options.deviceId, `mqtt:${options.mqttBroker}`, err.message);
    });

    client.on('close', async () => {
      console.warn(`[DevicePoller] MQTT disconnected for device ${options.deviceId}`);
      await options.onDeviceUnreachable(options.deviceId, `mqtt:${options.mqttBroker}`, 'MQTT disconnected');
    });

    return {
      deviceId: options.deviceId,
      mode: 'mqtt',
      mqttBroker: options.mqttBroker,
      mqttPort: options.mqttPort,
      mqttTopic: options.mqttTopic,
      pollInterval: options.pollInterval,
      mqttClient: client,
      ...processors,
    };
  }

  async stopRuntime(runtime: DeviceRuntime): Promise<void> {
    if (runtime.timer) clearInterval(runtime.timer);
    if (runtime.mqttClient) runtime.mqttClient.end(true);
  }

  private createProcessors(pollInterval: number, existing?: RuntimeProcessors): RuntimeProcessors {
    return {
      tracker: existing?.tracker ?? new AnomalyTracker(),
      windowMgr: existing?.windowMgr ?? new WindowManager(pollInterval),
      powerTracker: existing?.powerTracker ?? new PowerTracker(),
      powerWindowMgr: existing?.powerWindowMgr ?? new PowerWindowManager(),
    };
  }

  private async pollHttpDevice(
    options: StartHttpRuntimeOptions,
    processors: RuntimeProcessors,
  ): Promise<void> {
    let response: Response;

    try {
      response = await this.fetchFn(options.deviceIp, {
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      await options.onDeviceUnreachable(
        options.deviceId,
        options.deviceIp,
        err instanceof Error ? err.message : 'Fetch failed',
      );
      return;
    }

    if (!response.ok) {
      console.warn('[DevicePoller] Device %d HTTP %d', options.deviceId, response.status);
      await options.onDeviceUnreachable(options.deviceId, options.deviceIp, `HTTP ${response.status}`);
      return;
    }

    await options.onDeviceRecovered(options.deviceId, options.deviceIp);

    const raw = await response.json() as Record<string, string>;
    await options.onReading(options.deviceId, raw, new Date(), processors);
  }

  private async handleMqttMessage(
    options: StartMqttRuntimeOptions,
    payload: Buffer,
    processors: RuntimeProcessors,
  ): Promise<void> {
    let raw: Record<string, string>;

    try {
      raw = JSON.parse(payload.toString()) as Record<string, string>;
    } catch (err) {
      console.error(`[DevicePoller] Device ${options.deviceId} received invalid MQTT JSON:`, err);
      return;
    }

    await options.onReading(options.deviceId, raw, new Date(), processors);
  }

  private buildBrokerUrl(host: string, port?: number | null): string {
    if (
      host.startsWith('mqtt://') ||
      host.startsWith('mqtts://') ||
      host.startsWith('ws://') ||
      host.startsWith('wss://')
    ) {
      return host;
    }

    return `mqtt://${host}:${port ?? 1883}`;
  }
}
