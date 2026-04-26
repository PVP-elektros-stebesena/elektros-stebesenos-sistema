import Fastify from 'fastify';
import cors from '@fastify/cors';
import "dotenv/config";
import { voltageRoutes } from './routes/voltage.js';
import { powerRoutes } from './routes/power.js';
import { settingsRoutes } from './routes/settings.js';
import { reportRoutes } from './routes/reports.js';
import { notificationRoutes } from './routes/notifications.js';
import { exportRoutes } from './routes/exports.js';
import { authRoutes, requireAuthentication } from './routes/auth.js';
import { devicePoller } from './services/devicePoller.js';
import { startReportScheduler, stopReportScheduler } from './services/reportScheduler.js';
import { ConsoleNotificationSender, notificationService } from './services/notificationService.js';
import { createBrevoEmailNotificationSender } from './services/emailNotificationSender.js';
import { startSpotPriceScheduler, stopSpotPriceScheduler } from './services/spotPriceScheduler.js';
import { startStandbyPowerScheduler, stopStandbyPowerScheduler } from './services/standbyPowerScheduler.js';

const fastify = Fastify({ logger: true });

fastify.register(cors, {
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
});

fastify.get('/hello', async() => {
    return { message: 'Hello, World!' };
});

// Voltage analysis & grid quality endpoints
fastify.register(authRoutes);
fastify.addHook('onRequest', requireAuthentication);
fastify.register(voltageRoutes);
fastify.register(powerRoutes);

// Device settings CRUD endpoints
fastify.register(settingsRoutes);

// Report generation & retrieval endpoints
fastify.register(reportRoutes);

// Notification event toggle endpoints
fastify.register(notificationRoutes);

// Export endpoints
await fastify.register(exportRoutes);
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
        await startSpotPriceScheduler(parseInt(process.env.SPOT_PRICE_BACKFILL_DAYS || '7', 10));
        await startStandbyPowerScheduler();
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

// Graceful shutdown
async function shutdown() {
    console.log('Shutting down…');
    stopStandbyPowerScheduler();
    stopSpotPriceScheduler();
    stopReportScheduler();
    await devicePoller.stop();
    await fastify.close();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
