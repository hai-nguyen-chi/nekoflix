import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      /**
       * Thử lại lỗi NGHIỆP VỤ là vô ích: 404 vẫn là 404, 403 vẫn là 403.
       * Nó chỉ làm người dùng chờ lâu hơn trước khi thấy thông báo lỗi.
       * Chỉ thử lại lỗi hạ tầng (5xx), và chỉ một lần.
       */
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
    // Mutation KHÔNG BAO GIỜ tự thử lại: gửi lại một thao tác ghi có thể
    // tạo bản ghi trùng, trừ khi endpoint đã idempotent.
    mutations: { retry: false },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
