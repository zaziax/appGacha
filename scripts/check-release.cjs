const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const version = require('../package.json').version
const tag = `v${version}`
const release = path.join(root, 'release')

function checkMetadata() {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Expected a stable version such as 0.1.3')
  if (process.env.GITHUB_REF_TYPE === 'tag') {
    assert.equal(process.env.GITHUB_REF_NAME, tag, 'The tag must match the package version')
  }
  if (process.env.EXPECTED_ARCH) {
    assert.equal(process.arch, process.env.EXPECTED_ARCH, 'Wrong build architecture')
  }
  const lock = require('../package-lock.json')
  assert.equal(lock.version, version, 'Lockfile version differs from package.json')
  assert.equal(lock.packages[''].version, version, 'Lockfile root package differs from package.json')
  const notes = fs.readFileSync(path.join(root, 'docs', 'releases', `${tag}.md`), 'utf8')
  assert.match(notes, /^## English\s*$/m, 'English release notes are missing')
  assert.match(notes, /^## 中文\s*$/m, 'Chinese release notes are missing')
  console.log(`Release metadata verified for ${tag} (${process.arch})`)
}

async function checksum(file) {
  const hash = createHash('sha512')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}

async function stageArtifacts(platform) {
  const { load } = require('js-yaml')
  const mac = platform === 'macos'
  assert.ok(mac || platform === 'windows', 'Expected macos or windows')
  const prefix = `AppGacha-${version}`
  const payloads = mac
    ? [`${prefix}-macos-arm64.zip`, `${prefix}-macos-arm64.dmg`]
    : [`${prefix}-windows-x64-setup.exe`]
  const manifest = mac ? 'latest-mac.yml' : 'latest.yml'
  const update = load(fs.readFileSync(path.join(release, manifest), 'utf8'))
  assert.equal(update.version, version, `${manifest} must advertise ${version}`)
  assert.deepEqual(update.files.map(file => file.url).sort(), [...payloads].sort(), 'Unexpected update payloads')
  assert.equal(update.path, payloads[0], 'Unexpected primary update payload')
  assert.equal(update.sha512, update.files.find(file => file.url === update.path).sha512, 'Primary update checksum differs')

  for (const { url, sha512, size } of update.files) {
    const file = path.join(release, url)
    const diskSize = fs.statSync(file).size
    assert.ok(diskSize > 0, `Empty payload: ${url}`)
    if (size !== undefined) assert.equal(diskSize, size, `Size mismatch: ${url}`)
    assert.equal(await checksum(file), sha512, `Checksum mismatch: ${url}`)
  }

  const assets = [manifest, ...payloads, ...payloads.map(name => `${name}.blockmap`)]
  for (const name of assets) {
    assert.ok(fs.statSync(path.join(release, name)).size > 0, `Empty release asset: ${name}`)
  }
  const output = path.join(release, 'assets')
  fs.mkdirSync(output, { recursive: true })
  for (const name of assets) fs.copyFileSync(path.join(release, name), path.join(output, name))
  console.log(`Verified ${manifest} and staged ${assets.join(', ')}`)
}

async function main() {
  const [mode, platform] = process.argv.slice(2)
  if (mode === 'metadata') checkMetadata()
  else if (mode === 'artifacts') await stageArtifacts(platform)
  else throw new Error('Usage: check-release.cjs metadata | artifacts <macos|windows>')
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
