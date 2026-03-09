import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const port = Number.parseInt(process.env.APP_PORT ?? '3010', 10);
  await app.listen(Number.isFinite(port) ? port : 3000);

  Logger.log(`HTTP server started on port ${port}`, 'Bootstrap');
}

void bootstrap();
