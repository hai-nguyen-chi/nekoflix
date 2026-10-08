<!--
  Nhánh nguồn phải đúng hướng, CI sẽ chặn nếu sai:
    feat/* fix/* chore/* ...  ->  develop
    develop                  ->  staging
    staging | hotfix/*       ->  master
-->

## Làm gì

<!-- Một đoạn: thay đổi gì, và VÌ SAO. Phần "vì sao" mới là thứ
     người review không tự đọc ra được từ diff. -->

## Kiểm chứng thế nào

<!-- Đã chạy gì để biết nó đúng? Dán kết quả nếu có.
     "Chạy thử thấy ổn" không phải kiểm chứng. -->

- [ ] **`pnpm ci:local`** — chạy đúng chuỗi lệnh của job CI, gồm cả
      `--frozen-lockfile`. Xanh ở đây thì CI gần như chắc chắn xanh.
- [ ] `pnpm smoke` (nếu có đụng tới luồng chạy thật)

## Rủi ro cần để ý

<!-- Chỗ nào dễ hỏng? Nếu không có thì ghi "không". -->

---

### Checklist

- [ ] **Hợp đồng**: nếu có sửa `packages/contracts`, đã chạy `pnpm test` và
      snapshot tương thích ngược **được commit kèm trong PR này**
- [ ] Nếu snapshot phải cập nhật bằng `UPDATE_CONTRACT_SNAPSHOT=1`, đã giải
      thích ở mục "Rủi ro" **vì sao thay đổi phá vỡ tương thích là chấp nhận được**
- [ ] Không commit `.env`, secret, hay file trong `.data/`
- [ ] Tài liệu đã cập nhật nếu thay đổi cách chạy / cách setup
