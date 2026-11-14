const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const release = path.join(__dirname, '..', 'release')
const executables = {
  darwin: 'mac-arm64/AppGacha.app/Contents/MacOS/AppGacha',
  win32: 'win-unpacked/AppGacha.exe',
}

function main() {
  const executable = executables[process.platform]
  if (!executable) throw new Error(`Unsupported smoke platform: ${process.platform}`)

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-packaged-smoke-'))
  try {
    const userData = path.join(root, 'profile')
    const egg = path.join(userData, 'eggs', 'release-smoke.gacha')
    fs.mkdirSync(egg, { recursive: true })
    fs.mkdirSync(path.join(root, 'dist'))
    fs.writeFileSync(path.join(egg, 'manifest.json'), JSON.stringify({
      eggId: 'b24e4873-5a3a-4e44-8df8-a3c0fee26290',
      name: 'Release Smoke Test',
      version: '1.0.0',
      hostApiVersion: '1',
      permissions: ['storage', 'db', 'fs', 'schedule'],
    }))
    fs.writeFileSync(path.join(egg, 'index.html'), '<!doctype html><html lang="en"><title>Release Smoke Test</title><body><main>AppGacha</main></body></html>')

    const env = { ...process.env, APPGACHA_TEST_USER_DATA: userData }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(path.join(release, executable), [
      '--disable-gpu', '--in-process-gpu', '--enable-unsafe-swiftshader', '--smoke',
    ], { cwd: root, env, stdio: 'inherit', timeout: 120_000 })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Packaged AppGacha smoke test failed (${result.signal ?? result.status})`)
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
