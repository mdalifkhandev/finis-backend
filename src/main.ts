import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { NextFunction, Request, Response } from 'express';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('HTTP');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, 
  });

  const safeStringify = (value: unknown) => {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  };

  app.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const { method, originalUrl, query, body } = request;
    const payload =
      method === 'GET' || method === 'DELETE'
        ? `query=${safeStringify(query)}`
        : `query=${safeStringify(query)} body=${safeStringify(body)}`;

    logger.log(`[REQ] ${method} ${originalUrl} ${payload}`);

    response.on('finish', () => {
      const duration = Date.now() - startedAt;
      const logMessage = `[RES] ${method} ${originalUrl} ${response.statusCode} ${duration}ms`;

      if (response.statusCode >= 500) {
        logger.error(logMessage);
        return;
      }

      if (response.statusCode >= 400) {
        logger.warn(logMessage);
        return;
      }

      logger.log(logMessage);
    });

    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

    // Global Exception Filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global Response Interceptor
  app.useGlobalInterceptors(new ResponseInterceptor());
  
  app.enableCors();

app.useStaticAssets(join(process.cwd(), 'uploads'), {
  prefix: '',
});

  const port =  6000;

  await app.listen(port, '0.0.0.0');

  console.log(`Server running on port ${port}`);
}

bootstrap();