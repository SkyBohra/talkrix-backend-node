import { existsSync } from 'fs';
import { join } from 'path';

export function getEnvFilePath(): string {
  const env = process.env.APP_ENV || process.env.NODE_ENV || 'local';
  const envFile = `.env.${env}`;
  const envPath = join(__dirname, '..', envFile);
  if (existsSync(envPath)) {
    return envPath;
  }
  // fallback to default .env
  const defaultEnv = join(__dirname, '..', '.env');
  return existsSync(defaultEnv) ? defaultEnv : join(__dirname, '..', '.env');
}
