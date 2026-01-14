import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CorpusController } from './corpus.controller';
import { CorpusService } from './corpus.service';
import { TalkrixCorpusService } from './talkrix-corpus.service';
import { Corpus, CorpusSchema, CorpusSource, CorpusSourceSchema, CorpusDocument, CorpusDocumentSchema } from './corpus.schema';
import { UserModule } from '../user/user.module';
import { SharedModule } from '../shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Corpus.name, schema: CorpusSchema },
      { name: CorpusSource.name, schema: CorpusSourceSchema },
      { name: CorpusDocument.name, schema: CorpusDocumentSchema },
    ]),
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
  controllers: [CorpusController],
  providers: [CorpusService, TalkrixCorpusService],
  exports: [CorpusService, TalkrixCorpusService],
})
export class CorpusModule {}
