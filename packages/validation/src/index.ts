import { z } from 'zod';

export const healthStatusSchema = z.object({ status: z.literal('ok'), service: z.string() });
