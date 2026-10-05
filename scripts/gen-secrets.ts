/**
 * Sinh secret cho .env.
 *
 * Chạy: pnpm gen:secrets
 *
 * Chỉ ghi đè những key đang để TRỐNG — chạy lại nhiều lần không làm mất
 * secret đã có (quan trọng: đổi JWT key là đá toàn bộ người dùng ra).
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env');
const EXAMPLE_PATH = resolve(process.cwd(), '.env.example');

function generateRsaKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  // .env không chứa được xuống dòng thật -> escape
  return {
    privateKey: privateKey.replace(/\n/g, '\\n'),
    publicKey: publicKey.replace(/\n/g, '\\n'),
  };
}

function main(): void {
  if (!existsSync(ENV_PATH)) {
    if (!existsSync(EXAMPLE_PATH)) {
      console.error('Không tìm thấy .env lẫn .env.example. Chạy từ thư mục gốc dự án.');
      process.exit(1);
    }
    writeFileSync(ENV_PATH, readFileSync(EXAMPLE_PATH, 'utf8'));
    console.log('Đã tạo .env từ .env.example');
  }

  let content = readFileSync(ENV_PATH, 'utf8');
  const { privateKey, publicKey } = generateRsaKeyPair();

  const secrets: Record<string, string> = {
    JWT_PRIVATE_KEY: privateKey,
    JWT_PUBLIC_KEY: publicKey,
    PLAYBACK_TOKEN_SECRET: randomBytes(32).toString('base64url'),
    APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    BILLING_WEBHOOK_SECRET: randomBytes(32).toString('base64url'),
    SERVICE_DB_PASSWORD: randomBytes(16).toString('base64url'),
  };

  const filled: string[] = [];
  const skipped: string[] = [];

  for (const [key, value] of Object.entries(secrets)) {
    // Khớp cả dòng đang bị comment
    const pattern = new RegExp(`^#?\\s*${key}=(.*)$`, 'm');
    const match = content.match(pattern);

    if (match && match[1] && match[1].trim() !== '') {
      skipped.push(key);
      continue;
    }

    if (match) {
      content = content.replace(pattern, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
    filled.push(key);
  }

  writeFileSync(ENV_PATH, content);

  console.log(`\nĐã sinh ${filled.length} secret:`);
  for (const k of filled) console.log(`  + ${k}`);
  if (skipped.length) {
    console.log(`\nGiữ nguyên ${skipped.length} secret đã có:`);
    for (const k of skipped) console.log(`  = ${k}`);
  }
  console.log('\nLƯU Ý: SERVICE_DB_PASSWORD đổi thì phải chạy lại `pnpm infra:reset`');
  console.log('       để MongoDB tạo lại user với mật khẩu mới.\n');
}

main();
