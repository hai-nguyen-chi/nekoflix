/// <reference types="vite/client" />

/**
 * Khai báo kiểu cho biến môi trường.
 *
 * Thiếu file này, `import.meta.env.VITE_API_URL` có kiểu `any` và mọi
 * ràng buộc kiểu phía sau nó tan biến — ESLint bắt đúng.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
