
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
  
  // Enable CORS for frontend (local and production)
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'https://www.talkrix.com',
    'https://talkrix.com',
    process.env.FRONTEND_URL, // Production frontend URL from env
  ].filter(Boolean); // Remove undefined values

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (like mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      // Allow any vercel.app domain, talkrix.com, or configured origins
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') ||
        origin.endsWith('.netlify.app') ||
        origin.endsWith('.talkrix.com')
      ) {
        return callback(null, true);
      }
      
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });
  
  console.log('MONGO_URI:', configService.get('MONGO_URI'));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
