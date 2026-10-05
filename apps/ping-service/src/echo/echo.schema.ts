import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'echoes', timestamps: true })
export class Echo {
  @Prop({ type: String, required: true, unique: true })
  echoId!: string;

  @Prop({ type: String, required: true })
  message!: string;

  @Prop({ type: String, required: true })
  createdBy!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type EchoDocument = HydratedDocument<Echo>;
export const EchoSchema = SchemaFactory.createForClass(Echo);

EchoSchema.index({ createdAt: -1 });
