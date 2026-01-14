
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from './app.logger';
import { AllExceptionsFilter } from './all-exceptions.filter';



async function bootstrap() {

  const app = await NestFactory.create(AppModule, {
    logger: new AppLogger(),
  });
  const configService = app.get(ConfigService);
  app.useGlobalFilters(new AllExceptionsFilter());
  
  // Enable CORS for all origins
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Accept', 'Origin', 'X-Requested-With'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  
 
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
