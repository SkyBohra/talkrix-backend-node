import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Tool, ToolSchema } from './tool.schema';
import { ToolService } from './tool.service';
import { ToolController } from './tool.controller';
import { UltravoxToolService } from './ultravox-tool.service';
import { UserModule } from '../user/user.module';
import { SharedModule } from '../shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Tool.name, schema: ToolSchema }]),
    HttpModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
      inject: [ConfigService],
    }),
    UserModule,
    SharedModule,
  ],
  providers: [ToolService, UltravoxToolService],
  controllers: [ToolController],
  exports: [ToolService, UltravoxToolService],
})
export class ToolModule {}
