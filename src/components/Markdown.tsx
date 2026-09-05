import { renderMarkdown } from "@/lib/markdown";

/**
 * 渲染 Markdown 正文。
 *
 * 这里用 dangerouslySetInnerHTML 是安全的：renderMarkdown 先转义全部 HTML
 * 特殊字符再套语法，产出的标签集合完全由渲染器决定，不受输入控制。
 */
export function Markdown({
  source,
  className = "prose",
}: {
  source: string;
  className?: string;
}) {
  const html = renderMarkdown(source);

  if (!html) {
    return null;
  }

  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
