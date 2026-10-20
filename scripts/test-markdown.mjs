// Direct test of the markdown renderer
import { renderMarkdown } from "../dist/ui/markdown.js"

const sample = `## Hello from IBR

Here's an **example** with \`inline code\` and:

- A list item with bold text
- Another item with [a link](https://example.com)
- Third item

### Code block
\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`
}
\`\`\`

> This is a blockquote with useful info.

---

That's all.`

console.log("=== rendered markdown ===")
console.log(renderMarkdown(sample, { width: 80 }))
console.log("\n=== end ===")
