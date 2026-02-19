import Fastify from 'fastify';
import cors from '@fastify/cors';
import "dotenv/config";

const fastify = Fastify({ logger: true });

fastify.register(cors, {
    origin: "http://localhost:5173"
});

fastify.get('/hello', async() => {
    return { message: 'Hello, World!' };
});

const start = async () => {
    try {
        await fastify.listen({ port: parseInt(process.env.PORT || '3000') });
        console.log('Server is running on http://localhost:' + process.env.PORT || '3000');
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();