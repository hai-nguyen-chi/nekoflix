import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let replSet: MongoMemoryReplSet | undefined;

/**
 * REPLICA SET, không phải standalone.
 *
 * Toàn bộ giá trị của outbox nằm ở chỗ ghi dữ liệu + ghi event trong MỘT
 * transaction — mà MongoDB chỉ cho dùng transaction trên replica set. Test
 * trên standalone sẽ "xanh" vì không có transaction nào chạy cả, và bug thật
 * chỉ lộ ra ở production.
 */
export async function startMongo(): Promise<string> {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replSet.getUri();
  await mongoose.connect(uri, { dbName: 'test' });
  return uri;
}

export async function stopMongo(): Promise<void> {
  await mongoose.disconnect();
  await replSet?.stop();
  replSet = undefined;
}

export async function clearCollections(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
