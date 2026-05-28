import {
  defineConfig,
  defineDocs,
  frontmatterSchema,
  metaSchema,
} from "fumadocs-mdx/config";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export const docs = defineDocs({
  dir: "content/docs",
  docs: { schema: frontmatterSchema },
  meta: { schema: metaSchema },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMath],
    rehypePlugins: (existing) => [rehypeKatex, ...existing],
  },
});
