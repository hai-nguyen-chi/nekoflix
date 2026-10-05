import type { HydratedDocument } from 'mongoose';
export declare class Echo {
  echoId: string;
  message: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
export type EchoDocument = HydratedDocument<Echo>;
export declare const EchoSchema: import('mongoose').Schema<
  Echo,
  import('mongoose').Model<
    Echo,
    any,
    any,
    any,
    import('mongoose').Document<unknown, any, Echo, any, {}> &
      Echo & {
        _id: import('mongoose').Types.ObjectId;
      } & {
        __v: number;
      },
    any
  >,
  {},
  {},
  {},
  {},
  import('mongoose').DefaultSchemaOptions,
  Echo,
  import('mongoose').Document<
    unknown,
    {},
    import('mongoose').FlatRecord<Echo>,
    {},
    import('mongoose').DefaultSchemaOptions
  > &
    import('mongoose').FlatRecord<Echo> & {
      _id: import('mongoose').Types.ObjectId;
    } & {
      __v: number;
    }
>;
//# sourceMappingURL=echo.schema.d.ts.map
