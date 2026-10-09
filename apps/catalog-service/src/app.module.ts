import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServiceKitModule } from '@nekoflix/service-kit';
import { Title, TitleSchema } from './persistence/schemas/title.schema';
import { Episode, EpisodeSchema } from './persistence/schemas/episode.schema';
import { Genre, GenreSchema } from './persistence/schemas/genre.schema';
import { Person, PersonSchema } from './persistence/schemas/person.schema';
import { TitleController } from './api/title.controller';
import { EpisodeController } from './api/episode.controller';
import { TitleService } from './application/title.service';
import { EpisodeService } from './application/episode.service';

@Module({
  imports: [
    ServiceKitModule.forRoot({
      name: 'catalog-service',
      version: '0.1.0',
      database: 'nekoflix_catalog',
      /**
       * Bật sẵn outbox dù chưa phát event nào.
       *
       * Nó dựng collection `outbox`, chạy relay, và đăng ký metric
       * `outbox_pending_count` ngay từ đầu. Bật muộn nghĩa là feature đầu
       * tiên phát event sẽ phải vừa lo nghiệp vụ vừa lo hạ tầng — và đó
       * đúng lúc dễ bỏ sót nhất.
       */
      outbox: true,
      /** Phase 3 sẽ bật để nghe media.asset.ready */
      consumeEvents: false,
    }),
    MongooseModule.forFeature([
      { name: Title.name, schema: TitleSchema },
      { name: Episode.name, schema: EpisodeSchema },
      { name: Genre.name, schema: GenreSchema },
      { name: Person.name, schema: PersonSchema },
    ]),
  ],
  controllers: [TitleController, EpisodeController],
  providers: [TitleService, EpisodeService],
})
export class AppModule {}
