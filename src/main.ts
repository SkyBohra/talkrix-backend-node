
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
  
  // Enable CORS for all origins (development mode)
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });
  
  console.log('MONGO_URI:', configService.get('MONGO_URI'));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
