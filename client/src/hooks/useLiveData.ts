import { useState, useEffect } from 'react';
import type { LiveData } from '../types/energy';

const INIT: LiveData = {
  timestamp: new Date(),
  power_delivered: 1.847,
  power_returned: 0.312,
  gas_flow: 0.023,
  voltage_l1: 231.4,
  voltage_l2: 230.8,
  voltage_l3: 232.1,
  current_l1: 4.2,
  current_l2: 3.8,
  current_l3: 5.1,
  power_l1: 0.971,
  power_l2: 0.877,
  power_l3: 1.183,
  tariff: 2,
  total_t1_import: 2847.391,
  total_t2_import: 1923.847,
  total_t1_export: 412.38,
  total_t2_export: 289.11,
  total_gas: 1847.293,
};

function nudge(v: number, d: number, min = 0): number {
  return +Math.max(min, v + (Math.random() - 0.5) * d).toFixed(3);
}

export function useLiveData(ms = 2000) {
  const [data, setData] = useState<LiveData>(INIT);

  useEffect(() => {
    const id = setInterval(() => {
      setData(p => {
        const p1 = nudge(p.power_l1, 0.12);
        const p2 = nudge(p.power_l2, 0.10);
        const p3 = nudge(p.power_l3, 0.14);
        return {
          ...p,
          timestamp: new Date(),
          power_delivered: +(p1 + p2 + p3).toFixed(3),
          power_returned: nudge(p.power_returned, 0.06),
          gas_flow: nudge(p.gas_flow, 0.004),
          voltage_l1: nudge(p.voltage_l1, 0.5, 220),
          voltage_l2: nudge(p.voltage_l2, 0.5, 220),
          voltage_l3: nudge(p.voltage_l3, 0.5, 220),
          current_l1: nudge(p.current_l1, 0.3),
          current_l2: nudge(p.current_l2, 0.3),
          current_l3: nudge(p.current_l3, 0.3),
          power_l1: p1, power_l2: p2, power_l3: p3,
          tariff: new Date().getHours() >= 7 && new Date().getHours() < 23 ? 2 : 1,
        };
      });
    }, ms);
    return () => clearInterval(id);
  }, [ms]);

  return data;
}