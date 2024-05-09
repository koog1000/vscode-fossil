const esbuild = require('esbuild');
const minify = process.argv.includes('--minify');
const sourcemap = process.argv.includes('--sourcemap');

function buildConfig(entryPoint, outfile) {
  return {
    minify,
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    sourcemap,
    target: 'node18',
    format: 'cjs',
    external: ['vscode', './gitExport', './praise'],
    ...(outfile ? {outfile} : {}),
  }
}

async function main() {
  const results = await Promise.all([
    esbuild.build(
      {...buildConfig('./src/main.ts', 'out/main.js')}
    ),
    esbuild.build(
      {...buildConfig('./src/praise.ts', 'out/praise.js'), external: ['vscode']}
    ),
    esbuild.build(
      {...buildConfig('./src/gitExport.ts', 'out/gitExport.js')}
    ),
    esbuild.build(
      {...buildConfig('./media/preview.ts', 'media/preview.js'), platform:'browser', format: 'iife'}
    ),
  ])
  console.log('fossil extension js files are ready')
}

main()
