# ADR-004: SPA thuần, không SSR

**Trạng thái**: Accepted
**Ngày**: 2026-10-05

## Bối cảnh

Next.js (hoặc Remix) là mặc định của phần lớn dự án React mới. Câu hỏi: Nekoflix có cần SSR không?

Đặc điểm nội dung của Nekoflix:

- **~95% màn hình nằm sau đăng nhập** — Browse, Watch, My List, Player, Admin
- Trang public chỉ có: landing, login/register, và (nếu muốn) trang chi tiết phim cho mục đích chia sẻ link
- Người dùng mở app rồi ở lại lâu (xem phim 1–2 tiếng), không phải vào-ra liên tục từ Google

## Các lựa chọn

### A. Next.js App Router (SSR/RSC)

### B. Vite SPA ← chọn

### C. Vite SPA + prerender tĩnh cho vài trang public

## Quyết định

Chọn **B**, với đường mở sang **C** nếu cần SEO cho trang chi tiết phim.

Lý do cốt lõi: **SSR giải quyết hai vấn đề — SEO và first contentful paint — mà Nekoflix gần như không có.**

Về SEO: nội dung sau đăng nhập không được Google index, và cũng không nên. Cái duy nhất đáng index là trang chi tiết phim để chia sẻ link có preview đẹp — mà việc đó chỉ cần Open Graph meta tag, giải được bằng prerender tĩnh hoặc một edge function nhỏ, không cần cả một runtime SSR.

Về FCP: người dùng Nekoflix mở app một lần rồi ở lại. Lợi ích của việc trang đầu nhanh hơn 300ms bị lu mờ hoàn toàn bởi thời gian họ ngồi xem phim. Ngược lại, SPA cho điều hướng **trong** app nhanh hơn vì không round-trip server.

Còn cái giá của SSR thì rất cụ thể và phải trả ngay:

1. **Thêm một runtime Node phải vận hành** — deploy, monitor, scale. Trong khi SPA chỉ là file tĩnh trên CDN, gần như không thể sập.
2. **Auth phức tạp hơn hẳn.** Mô hình token của dự án ([ADR trong 05](../05-authentication.md)) cố tình giữ access token **chỉ trong memory của browser** để chống XSS. Với SSR, server component cũng cần token để fetch dữ liệu → phải chuyển token sang cookie hoặc dựng một lớp proxy. Cả hai đều làm yếu đi hoặc làm phức tạp mô hình bảo mật đã thiết kế.
3. **Player không hưởng lợi gì từ SSR.** `hls.js` chỉ chạy ở client. Trang `/watch` sẽ luôn là client component — phần phức tạp nhất của app nằm ngoài vùng SSR phát huy tác dụng.
4. **Hai mô hình data fetching cùng tồn tại** (server component + TanStack Query ở client) làm tăng tải nhận thức mà không đổi lại giá trị tương xứng.

## Hệ quả

### Tích cực

- Frontend là file tĩnh → deploy lên Cloudflare Pages miễn phí, CDN toàn cầu, gần như không sập
- Mô hình auth giữ nguyên được thiết kế an toàn: token chỉ trong memory
- Một mô hình data fetching duy nhất: TanStack Query
- Dev server Vite khởi động dưới 1 giây, HMR tức thì
- Tách bạch rõ ràng frontend/backend — dễ giải thích kiến trúc, dễ onboard

### Cái giá phải trả

- **SEO kém cho trang public.** Share link phim lên Facebook/Zalo sẽ không có preview nếu không làm thêm bước prerender
- **Màn hình trắng ban đầu** cho tới khi JS tải xong. Giảm nhẹ bằng skeleton HTML viết sẵn trong `index.html`
- Bundle JS gửi về client lớn hơn so với RSC
- Không dùng được các tiện ích đi kèm Next.js: `next/image` tối ưu ảnh, API routes, middleware — phải tự làm hoặc dùng dịch vụ khác

### Đường mở sang phương án C

Nếu sau này cần preview khi share link:

```
vite-plugin-prerender hoặc một script build nhỏ
  → tại build time, fetch danh sách title đã publish
  → sinh ra /title/<slug>/index.html tĩnh với đầy đủ OG meta tag
  → deploy kèm SPA
```

Chi phí: thêm một bước build, phải rebuild khi thêm phim mới. Chấp nhận được ở quy mô 50 phim. Không cần động tới kiến trúc.

### Khi nào nên xem lại

- Nếu nội dung public trở thành kênh thu hút người dùng chính (vd: có blog, có trang review công khai)
- Nếu số title vượt vài nghìn, prerender tĩnh không còn khả thi
- Nếu đo được rằng người dùng thực sự rời đi vì màn hình trắng ban đầu
