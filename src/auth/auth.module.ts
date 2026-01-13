import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserModule } from '../user/user.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SharedModule } from '../shared.module';

@Module({
  imports: [
    UserModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
      console.log('JWT_SECRET:', configService.get('JWT_SECRET'));
      return {
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      };
    },
      inject: [ConfigService],
    }),
    SharedModule,
  ],
  providers: [AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
