/**
 * 主题名解析。
 *
 * 与注册表分开：注册表要 import 主题的 React 组件，而这段逻辑是纯的，
 * 单独放才能在不加载整棵组件树的情况下测。
 */
export function resolveThemeName(
  requested: string | undefined,
  registered: readonly string[],
  fallback: string,
): { name: string; fellBack: boolean } {
  if (!requested) {
    return { name: fallback, fellBack: false };
  }

  if (registered.includes(requested)) {
    return { name: requested, fellBack: false };
  }

  // 上线时因为主题名拼错而整站白屏，比用默认主题渲染糟糕得多
  return { name: fallback, fellBack: true };
}
