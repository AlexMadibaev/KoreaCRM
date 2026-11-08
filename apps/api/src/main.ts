import 'reflect-metadata';
import './config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { FinancialFieldsInterceptor } from './auth/financial-fields';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalInterceptors(new FinancialFieldsInterceptor());
  const allowedOrigins = [process.env.WEB_ORIGIN ?? 'http://localhost:3000', process.env.POS_ORIGIN ?? 'http://localhost:5173', 'http://tauri.localhost', 'tauri://localhost'].flatMap(value => value.split(',').map(origin => origin.trim()).filter(Boolean));
  app.enableCors({ origin: allowedOrigins });
  const swaggerConfig = new DocumentBuilder().setTitle('Korea CRM API').setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  await app.listen(Number(process.env.API_PORT ?? 3001), process.env.API_HOST ?? '0.0.0.0');
}

void bootstrap();
