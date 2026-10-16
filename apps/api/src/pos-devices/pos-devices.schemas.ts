import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export const registerDeviceSchema = z.object({ deviceId: z.string().trim().min(1).max(100), appVersion: z.string().trim().min(1).max(40) });
export const statusSchema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) });
export function parseInput<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> { const result = schema.safeParse(value); if (!result.success) throw new BadRequestException(result.error.flatten()); return result.data; }
