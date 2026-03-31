import type { MqttClient } from 'mqtt';
import { AnomalyTracker } from './anomalyTracker.js';
import { PowerTracker } from './powerTracker.js';
import { PowerWindowManager } from './powerWindowManager.js';
import { WindowManager } from './windowManager.js';

export interface RuntimeProcessors {
  tracker: AnomalyTracker;
  windowMgr: WindowManager;
  powerTracker: PowerTracker;
  powerWindowMgr: PowerWindowManager;
}

export interface DeviceRuntime extends RuntimeProcessors {
  deviceId: number;
  mode: 'http' | 'mqtt';
  deviceIp?: string;
  mqttBroker?: string;
  mqttPort?: number | null;
  mqttTopic?: string;
  pollInterval: number;
  timer?: ReturnType<typeof setInterval>;
  mqttClient?: MqttClient;
}
