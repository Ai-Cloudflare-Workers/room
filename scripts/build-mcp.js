const { execSync, execFileSync } = require('child_process')
const { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } = require('fs')
const path = require('path')
const { version, dependencies, allowScripts } = require('../package.json')

const OUT_DIR = 'out/mcp'
const NODE_MODULES_DIR = path.join(OUT_DIR, 'node_modules')
const INSTALL_META_PATH = path.join(OUT_DIR, '.install-meta.json')

const EXTERNALS = [
  'better-sqlite3',
  'sqlite-vec',
  '@huggingface/transformers',
  'onnxruntime-node',
  'playwright',
  'playwright-core'
]

const REQUIRED_PACKAGES = [
  'better-sqlite3',
  'sqlite-vec',
  '@huggingface/transformers',
  'playwright',
  'ws'
]

const COMMON = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: EXTERNALS,
  define: { __APP_VERSION__: JSON.stringify(version) },
  logLevel: 'warning',
}

function packageInstalled(name) {
  return existsSync(path.join(NODE_MODULES_DIR, ...name.split('/'), 'package.json'))
}

function getInstallReasons() {
  const reasons = []

  if (!existsSync(NODE_MODULES_DIR)) reasons.push('missing out/mcp/node_modules')
  for (const name of REQUIRED_PACKAGES) {
    if (!packageInstalled(name)) reasons.push(`missing dependency "${name}"`)
  }

  let meta = null
  if (!existsSync(INSTALL_META_PATH)) {
    reasons.push('missing native dependency install metadata')
  } else {
    try {
      meta = JSON.parse(readFileSync(INSTALL_META_PATH, 'utf8'))
    } catch {
      reasons.push('invalid native dependency install metadata')
    }
  }

  if (meta) {
    if (meta.platform !== process.platform || meta.arch !== process.arch) {
      reasons.push(`native dependencies built for ${meta.platform}/${meta.arch}, need ${process.platform}/${process.arch}`)
    }
  }

  if (packageInstalled('better-sqlite3')) {
    try {
      const moduleDir = path.resolve(NODE_MODULES_DIR, 'better-sqlite3')
      const installed = JSON.parse(readFileSync(path.join(moduleDir, 'package.json'), 'utf8'))
      if (installed.version !== dependencies['better-sqlite3']) {
        reasons.push(`better-sqlite3 ${installed.version} differs from required ${dependencies['better-sqlite3']}`)
      } else {
        // N-API releases embed platform prebuilds instead of build/Release binaries.
        // Probe in a child so an incompatible native addon cannot abort the builder.
        execFileSync(process.execPath, ['-e', `require(${JSON.stringify(moduleDir)})(':memory:').close()`], {
          timeout: 10000, stdio: 'pipe'
        })
      }
    } catch (error) {
      reasons.push(`better-sqlite3 runtime probe failed: ${error.message}`)
    }
  }

  return reasons
}

function writeInstallMeta() {
  writeFileSync(
    INSTALL_META_PATH,
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node
    }, null, 2)
  )
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  // Bundle all three entry points in parallel
  const esbuild = require('esbuild')
  await Promise.all([
    esbuild.build({ ...COMMON, entryPoints: ['src/mcp/server.ts'], outfile: path.join(OUT_DIR, 'server.js') }),
    esbuild.build({ ...COMMON, entryPoints: ['src/cli/index.ts'], outfile: path.join(OUT_DIR, 'cli.js') }),
    esbuild.build({ ...COMMON, entryPoints: ['src/server/index.ts'], outfile: path.join(OUT_DIR, 'api-server.js'), external: [...EXTERNALS, 'ws'] }),
  ])

  // Create package.json for native dependencies
  writeFileSync(path.join(OUT_DIR, 'package.json'), JSON.stringify({
    name: 'quoroom-mcp',
    version,
    private: true,
    allowScripts,
    engines: { node: '^22.12.0 || ^24.0.0 || >=26.0.0', npm: '>=11.16.0' },
    dependencies: {
      'better-sqlite3': dependencies['better-sqlite3'],
      'sqlite-vec': dependencies['sqlite-vec'],
      '@huggingface/transformers': dependencies['@huggingface/transformers'],
      'playwright': dependencies['playwright'],
      'ws': dependencies['ws']
    }
  }, null, 2))

  // Reinstall native deps when missing/stale/platform-mismatched.
  // In local dev, QUOROOM_SKIP_MCP_NPM_INSTALL=1 can skip this intentionally.
  const skipInstall = process.env.QUOROOM_SKIP_MCP_NPM_INSTALL === '1'
  const installReasons = getInstallReasons()
  if (installReasons.length > 0) {
    if (skipInstall) {
      console.warn(
        'Skipping out/mcp npm install due QUOROOM_SKIP_MCP_NPM_INSTALL=1 even though native deps look stale:\n'
        + installReasons.map((r) => `- ${r}`).join('\n')
      )
    } else {
      console.log(
        'Installing out/mcp native dependencies:\n'
        + installReasons.map((r) => `- ${r}`).join('\n')
      )
      rmSync(NODE_MODULES_DIR, { recursive: true, force: true })
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      execSync(`${npmCmd} install --omit=dev`, { cwd: OUT_DIR, stdio: 'inherit', timeout: 300000 })
      writeInstallMeta()
    }
  }

  if (!skipInstall) {
    const postInstallReasons = getInstallReasons()
    if (postInstallReasons.length > 0) {
      throw new Error(
        'out/mcp native dependencies are not ready after install:\n'
        + postInstallReasons.map((r) => `- ${r}`).join('\n')
      )
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
