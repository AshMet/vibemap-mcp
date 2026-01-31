import * as fs from "fs/promises";
import * as path from "path";
/**
 * Helper to walk directory and build a string representation
 */
export async function walkDir(dir, maxDepth, currentDepth = 0) {
    if (currentDepth >= maxDepth)
        return "";
    let result = "";
    const files = await fs.readdir(dir, { withFileTypes: true });
    for (const file of files) {
        if (file.name === "node_modules" || file.name === ".git" || file.name === ".next")
            continue;
        const indent = "  ".repeat(currentDepth);
        result += `${indent}${file.isDirectory() ? "[DIR] " : ""}${file.name}\n`;
        if (file.isDirectory()) {
            result += await walkDir(path.join(dir, file.name), maxDepth, currentDepth + 1);
        }
    }
    return result;
}
