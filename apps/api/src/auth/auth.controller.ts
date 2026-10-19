import { Body, Controller, Get, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { AccessGuard } from './guards';

const loginSchema = z.object({ login: z.string().min(1), password: z.string().min(1), deviceId: z.string().min(1).optional() });
const posCodeSchema = z.object({ code: z.string().trim().min(13).max(64), deviceId: z.string().min(1).max(150) });
const refreshSchema = z.object({ refreshToken: z.string().min(1), deviceId: z.string().min(1).optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: unknown) {
    const input = parse(loginSchema, body);
    return this.auth.login(input.login, input.password, input.deviceId);
  }

  @Post('pos-code')
  loginWithPosCode(@Body() body: unknown, @Req() request: Request) {
    const input = parse(posCodeSchema, body);
    return this.auth.loginWithPosCode(input.code, input.deviceId, request.ip ?? 'unknown');
  }

  @Post('refresh')
  refresh(@Body() body: unknown) {
    const input = parse(refreshSchema, body);
    return this.auth.refresh(input.refreshToken, input.deviceId);
  }

  @Post('logout')
  logout(@Body() body: unknown) {
    const input = parse(refreshSchema, body);
    return this.auth.logout(input.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AccessGuard)
  me(@Req() request: Request & { access: { userId: string } }) {
    return this.auth.context(request.access.userId);
  }
}
