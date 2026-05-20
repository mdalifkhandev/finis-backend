import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, 
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
  prefix: '/uploads',
});

  const port =  6000;

  await app.listen(port, '0.0.0.0');

  console.log(`Server running on port ${port}`);
}

bootstrap();