import type { Theme } from "./contract";
import { defaultTheme } from "./default";
import { resolveThemeName } from "./resolve";

/**
 * 主题注册表。
 *
 * 构建时选主题：`.dev.vars` 或部署环境里设 `THEME=<目录名>`，重新构建即生效。
 * 之所以不做运行时切换：单租户自部署场景下主题定了就不常动，而运行时切换
 * 需要把所有主题打进 Worker 包并处理静态页缓存失效，代价远大于收益。
 *
 * 新增主题：复制 src/themes/default 改名，实现 contract.ts 的 Theme 接口
 * （TypeScript 会强制你实现全部 View），在这里注册。
 */
const THEMES: Record<string, Theme> = {
  default: defaultTheme,
};

export const DEFAULT_THEME_NAME = "default";

export function listThemes(): Theme[] {
  return Object.values(THEMES);
}

export function getTheme(name = process.env.THEME): Theme {
  const { name: resolved, fellBack } = resolveThemeName(
    name,
    Object.keys(THEMES),
    DEFAULT_THEME_NAME,
  );

  if (fellBack) {
    console.warn(
      `[theme] unknown theme "${name}", falling back to "${DEFAULT_THEME_NAME}". Registered: ${Object.keys(THEMES).join(", ")}`,
    );
  }

  return THEMES[resolved];
}
