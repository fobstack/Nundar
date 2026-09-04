/**
 * 输出 JSON-LD 脚本块。
 * 用 </script 转义防止内容里的字符串提前闭合脚本标签造成 XSS。
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/<\/script/gi, "<\\/script");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
