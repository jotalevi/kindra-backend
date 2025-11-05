const fs = require('fs').promises;
const path = require('path');

const SRC = path.join(process.cwd(), 'src');
const DIST = path.join(process.cwd(), 'dist');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function walkAndCopy(srcDir, distDir) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const distPath = path.join(distDir, entry.name);

    if (entry.isDirectory()) {
      await walkAndCopy(srcPath, distPath);
    } else if (entry.isFile()) {
      // Skip TypeScript sources and declaration files
      if (srcPath.endsWith('.ts') || srcPath.endsWith('.tsx') || srcPath.endsWith('.d.ts')) continue;

      await ensureDir(path.dirname(distPath));
      try {
        await fs.copyFile(srcPath, distPath);
        console.log(`Copied ${path.relative(process.cwd(), srcPath)} -> ${path.relative(process.cwd(), distPath)}`);
      } catch (err) {
        console.error(`Failed to copy ${srcPath} -> ${distPath}:`, err);
      }
    }
  }
}

(async () => {
  try {
    await walkAndCopy(SRC, DIST);
    console.log('Asset copy complete.');
  } catch (err) {
    console.error('Error copying assets:', err);
    process.exit(1);
  }
})();
