import Fastify from 'fastify';
import cors from '@fastify/cors';
import "dotenv/config";
import { voltageRoutes } from './routes/voltage.js';
import { settingsRoutes } from './routes/settings.js';
import { reportRoutes } from './routes/reports.js';
import { notificationRoutes } from './routes/notifications.js';
import { devicePoller } from './services/devicePoller.js';
import { startReportScheduler, stopReportScheduler } from './services/reportScheduler.js';
import { ConsoleNotificationSender, notificationService } from './services/notificationService.js';
import { createBrevoEmailNotificationSender } from './services/emailNotificationSender.js';

const fastify = Fastify({ logger: true });

fastify.register(cors, {
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

fastify.get('/hello', async() => {
    return { message: 'Hello, World!' };
});

// Voltage analysis & grid quality endpoints
fastify.register(voltageRoutes);

// Device settings CRUD endpoints
fastify.register(settingsRoutes);

// Report generation & retrieval endpoints
fastify.register(reportRoutes);

// Notification event toggle endpoints
fastify.register(notificationRoutes);

// Poller status endpoint
fastify.get('/api/poller/status', async () => {
    return { devices: devicePoller.getStatus() };
});

const start = async () => {
    try {
        devicePoller.setNotificationAdapter(notificationService);
        notificationService.addSender(new ConsoleNotificationSender());

        const emailSender = createBrevoEmailNotificationSender(process.env);
        if (emailSender) {
            notificationService.addSender(emailSender);
            console.log('[Notification] Brevo email sender enabled');
        } else {
            console.log('[Notification] Brevo email sender is disabled (missing env vars)');
        }

        await fastify.listen({ port: parseInt(process.env.PORT || '3000') });
        console.log('Server is running on http://localhost:' + (process.env.PORT || '3000'));

        // Start polling all active devices
        await devicePoller.start();

        // Start weekly report cron scheduler
        startReportScheduler();
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

// Graceful shutdown
async function shutdown() {
    console.log('Shutting down…');
    stopReportScheduler();
    await devicePoller.stop();
    await fastify.close();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();