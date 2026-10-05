import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { ListReceivedResponse } from '@nekoflix/contracts';
import { Received } from './received.schema';

@Controller()
export class ReceivedController {
  constructor(@InjectModel(Received.name) private readonly model: Model<Received>) {}

  @MessagePattern('pong.received.list')
  async list(): Promise<ListReceivedResponse> {
    const docs = await this.model.find().sort({ receivedAt: -1 }).limit(50).lean();
    return {
      items: docs.map((d) => ({
        echoId: d.echoId,
        message: d.message,
        receivedAt: new Date(d.receivedAt).toISOString(),
        deliveryCount: d.deliveryCount,
      })),
    };
  }
}
