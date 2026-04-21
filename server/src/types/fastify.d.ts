import type { PublicUser } from '../services/authService.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: PublicUser;
  }
}
