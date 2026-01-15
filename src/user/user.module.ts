import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User, UserSchema } from './user.schema';
import { UserService } from './user.service';
import { SettingsController } from './settings.controller';
import { SharedModule } from '../shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
      inject: [ConfigService],
    }),
    SharedModule,
  ],
  controllers: [SettingsController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
