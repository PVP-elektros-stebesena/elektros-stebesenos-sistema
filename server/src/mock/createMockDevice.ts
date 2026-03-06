import prisma from '../lib/prisma.js';

async function main() {
  const device = await prisma.device.create({
    data: {
      name: 'Mock Device 1',
      deviceIp: 'http://127.0.0.1:3001/smartmeter/api/read',
      mqttBroker: 'localhost',
      mqttPort: 1883,
      mqttTopic: 'mock/topic',
      pollInterval: 10,
      isActive: true,
    },
  });
  console.log('Created device:', device);
}

main().catch(console.error).finally(() => prisma.$disconnect());