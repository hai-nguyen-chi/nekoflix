import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

/**
 * Cấu hình ESLint dùng chung.
 *
 * Phần quan trọng nhất không phải style mà là CÁC RÀO CHẮN KIẾN TRÚC ở dưới:
 * chúng biến "distributed monolith" từ một sai lầm dễ mắc thành một lỗi
 * không compile được.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.js', '**/coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    plugins: { import: importPlugin },
    rules: {
      // Quên await là bug âm thầm — với event handler thì nó nuốt luôn lỗi
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',

      // ───────────────────────────────────────────────────────
      // RÀO CHẮN KIẾN TRÚC
      // ───────────────────────────────────────────────────────
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Một service import service khác = distributed monolith.
              // Chỉ được nói chuyện qua NATS (RpcClient) hoặc event.
              group: ['**/apps/*/src/**', '*-service/**', '../../*-service/**'],
              message:
                'Service không được import service khác. Dùng RpcClient (sync) hoặc @OnEvent (async).',
            },
            {
              // Chặn vượt ra khỏi package của mình.
              //
              // Trước đây quy tắc là `../../*` — quá rộng: nó chặn cả việc
              // điều hướng BÌNH THƯỜNG trong cùng một service, ví dụ
              // src/events/handlers/x.ts -> ../../persistence/schemas/y.
              // Cái cần chặn là vượt ranh giới package, không phải độ sâu.
              group: ['**/packages/*/src/**', '../../../*'],
              message:
                'Đi ra ngoài package của mình — import qua tên package workspace (@nekoflix/...).',
            },
          ],
        },
      ],
    },
  },

  // Domain phải thuần: không biết NATS, không biết Mongoose.
  // Nhờ vậy test domain không cần hạ tầng nào cả.
  {
    files: ['**/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@nestjs/microservices', message: 'domain/ không được biết tới transport.' },
            { name: 'mongoose', message: 'domain/ không được biết tới database.' },
            { name: 'nats', message: 'domain/ không được biết tới transport.' },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
