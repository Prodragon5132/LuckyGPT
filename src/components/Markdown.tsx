"use client";

import { memo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { CheckIcon, CopyIcon, DownloadIcon } from "./icons";
import { copyText } from "@/lib/client/utils";

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

const EXT: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  ruby: "rb",
  rust: "rs",
  markdown: "md",
  bash: "sh",
  shell: "sh",
  yaml: "yml",
  csharp: "cs",
  kotlin: "kt",
};

function CodeBlock({ language, children }: { language: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = textOf(children).replace(/\n$/, "");
  const download = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `snippet.${EXT[language] ?? (language || "txt")}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="code-block my-4 overflow-hidden rounded-2xl border border-line-2 bg-[var(--code-bg)]">
      <div className="flex items-center justify-between px-4 pb-1 pt-2.5 text-xs text-fg-2">
        <span className="font-medium">{language || "text"}</span>
        <div className="flex items-center gap-1">
          <button onClick={download} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-hover" aria-label="Download code">
            <DownloadIcon size={15} />
          </button>
          <button
            onClick={async () => {
              if (await copyText(code)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }
            }}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-hover"
          >
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto px-4 pb-4 pt-1 scroll-thin">
        <code className={language ? `hljs language-${language}` : "hljs"}>{children}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  pre({ children }) {
    // Extract language from the <code> child that rehype-highlight produced.
    const child = Array.isArray(children) ? children[0] : children;
    const props = (child as { props?: { className?: string; children?: ReactNode } })?.props ?? {};
    const match = /language-([\w+#-]+)/.exec(props.className ?? "");
    return <CodeBlock language={match?.[1] ?? ""}>{props.children}</CodeBlock>;
  },
  a({ href, children }) {
    const safe = href && /^(https?:|mailto:)/i.test(href) ? href : undefined;
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  // Never auto-load images from the internet (prevents tracking/data leaks).
  img({ src, alt }) {
    const url = typeof src === "string" ? src : "";
    if (/^https?:/i.test(url)) {
      return (
        <a href={url} target="_blank" rel="noopener noreferrer nofollow">
          [{alt || "image"}]
        </a>
      );
    }
    return <span>[{alt || "image"}]</span>;
  },
  table({ children }) {
    return (
      <div className="my-4 overflow-x-auto scroll-thin">
        <table>{children}</table>
      </div>
    );
  },
  input({ type, checked }) {
    if (type === "checkbox") return <input type="checkbox" checked={!!checked} readOnly className="mr-1.5 align-middle" />;
    return null;
  },
};

/** ChatGPT writes math as \( \) and \[ \]; remark-math wants $ and $$. */
function normalizeMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`);
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }], [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
});
