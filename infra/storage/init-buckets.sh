#!/bin/sh
# Tạo bucket qua S3 API chuẩn (AWS CLI), KHÔNG dùng CLI riêng của nhà cung cấp.
#
# Nhờ vậy script này chạy y nguyên với SeaweedFS (dev), và với S3 thật hay
# Cloudflare R2 (production) — chỉ cần đổi --endpoint-url.
#
# Idempotent: chạy lại nhiều lần không lỗi.
set -e

ENDPOINT="${S3_ENDPOINT:-http://storage:8333}"
S3="aws --endpoint-url $ENDPOINT s3"
S3API="aws --endpoint-url $ENDPOINT s3api"

echo "Đang chờ object storage tại $ENDPOINT ..."
until $S3 ls >/dev/null 2>&1; do
  echo "  chờ..."
  sleep 2
done

for bucket in nekoflix-uploads nekoflix-media nekoflix-public; do
  if $S3API head-bucket --bucket "$bucket" >/dev/null 2>&1; then
    echo "  = $bucket đã tồn tại"
  else
    $S3API create-bucket --bucket "$bucket"
    echo "  + $bucket"
  fi
done

# CORS cho nekoflix-uploads: browser PUT thẳng lên storage qua presigned URL,
# không đi qua API server (file video 2GB mà đi qua Node là hết RAM).
$S3API put-bucket-cors --bucket nekoflix-uploads --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:5173", "http://localhost:4000"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}' 2>/dev/null || echo "  (CORS: bỏ qua — storage chưa hỗ trợ, không ảnh hưởng Phase 0)"

echo ""
echo "Buckets sẵn sàng:"
$S3 ls
