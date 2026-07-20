const fs = require('node:fs')
const path = require('node:path')

const workspaceRoot = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'))
const changelog = fs.readFileSync(path.join(workspaceRoot, 'CHANGELOG.md'), 'utf8')
const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageJson.version)

if (!versionMatch) throw new Error(`package.json version is not a stable semantic version: ${packageJson.version}`)

const [, currentMajor, currentMinor] = versionMatch
const releases = [...changelog.matchAll(/^## \[(\d+)\.(\d+)\.(\d+)\] - /gm)]
if (releases.length === 0) throw new Error('CHANGELOG.md does not contain any version entries')

for (const [, major, minor] of releases) {
  if (major !== currentMajor || minor !== currentMinor)
    throw new Error(`CHANGELOG.md may only retain the current ${currentMajor}.${currentMinor}.x series`)
}

if (!releases.some(([entry]) => entry.includes(`[${packageJson.version}]`)))
  throw new Error(`CHANGELOG.md is missing an entry for ${packageJson.version}`)
