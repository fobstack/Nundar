import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

describe("renderMarkdown — safety", () => {
  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdown('<script>alert("x")</script>');

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML inside a link label", () => {
    const html = renderMarkdown("[<img onerror=alert(1)>](https://example.com)");

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("drops a javascript: link target rather than linking to it", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");

    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
  });

  it("drops a data: link target", () => {
    const html = renderMarkdown("[x](data:text/html;base64,PHNjcmlwdD4=)");
    expect(html).not.toContain("data:text/html");
  });

  it("keeps http, https, mailto and relative targets", () => {
    expect(renderMarkdown("[a](https://example.com)")).toContain('href="https://example.com"');
    expect(renderMarkdown("[a](http://example.com)")).toContain('href="http://example.com"');
    expect(renderMarkdown("[a](mailto:hi@example.com)")).toContain('href="mailto:hi@example.com"');
    expect(renderMarkdown("[a](/en/products)")).toContain('href="/en/products"');
  });

  it("escapes quotes in a URL so the attribute cannot be broken out of", () => {
    const html = renderMarkdown('[a](https://example.com/"onmouseover="alert(1))');
    expect(html).not.toContain('"onmouseover="');
  });
});

describe("renderMarkdown — block syntax", () => {
  it("renders paragraphs", () => {
    expect(renderMarkdown("First.\n\nSecond.")).toBe(
      "<p>First.</p>\n<p>Second.</p>",
    );
  });

  it("renders headings from level 2 to 4", () => {
    expect(renderMarkdown("## Title")).toBe("<h2>Title</h2>");
    expect(renderMarkdown("### Sub")).toBe("<h3>Sub</h3>");
    expect(renderMarkdown("#### Minor")).toBe("<h4>Minor</h4>");
  });

  it("demotes a level-1 heading, since the page already has an h1", () => {
    expect(renderMarkdown("# Top")).toBe("<h2>Top</h2>");
  });

  it("renders unordered lists", () => {
    expect(renderMarkdown("- one\n- two")).toBe(
      "<ul>\n<li>one</li>\n<li>two</li>\n</ul>",
    );
  });

  it("renders ordered lists", () => {
    expect(renderMarkdown("1. one\n2. two")).toBe(
      "<ol>\n<li>one</li>\n<li>two</li>\n</ol>",
    );
  });

  it("renders blockquotes", () => {
    expect(renderMarkdown("> note")).toBe("<blockquote><p>note</p></blockquote>");
  });

  it("renders a pipe table, which specification content needs", () => {
    const html = renderMarkdown(
      "| Size | Rating |\n| --- | --- |\n| DN50 | 1000 PSI |",
    );

    expect(html).toContain("<table>");
    expect(html).toContain("<th>Size</th>");
    expect(html).toContain("<td>DN50</td>");
    expect(html).toContain("<td>1000 PSI</td>");
  });

  it("keeps a table cell's content escaped", () => {
    const html = renderMarkdown("| a |\n| --- |\n| <b>x</b> |");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("returns an empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n  ")).toBe("");
  });
});

describe("renderMarkdown — inline syntax", () => {
  it("renders bold and italic", () => {
    expect(renderMarkdown("**bold**")).toBe("<p><strong>bold</strong></p>");
    expect(renderMarkdown("*italic*")).toBe("<p><em>italic</em></p>");
  });

  it("renders inline code without interpreting markup inside it", () => {
    expect(renderMarkdown("`**not bold**`")).toBe(
      "<p><code>**not bold**</code></p>",
    );
  });

  it("renders links", () => {
    expect(renderMarkdown("[shop](https://example.com)")).toBe(
      '<p><a href="https://example.com">shop</a></p>',
    );
  });

  it("leaves an unmatched asterisk alone rather than producing broken markup", () => {
    const html = renderMarkdown("2 * 3 = 6");
    expect(html).toBe("<p>2 * 3 = 6</p>");
  });

  it("preserves ampersands as entities", () => {
    expect(renderMarkdown("Food & beverage")).toBe("<p>Food &amp; beverage</p>");
  });
});
