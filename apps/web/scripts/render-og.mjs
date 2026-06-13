import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const WIDTH = 1200
const HEIGHT = 630
const CHROMIUM_VIEWPORT_HEIGHT = 718

const browserCandidates = [
  process.env.CHROMIUM_BIN,
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
].filter(Boolean)

const jobs = [
  {
    input: resolve('public/og/calibrafacil-cover-banner.html'),
    output: resolve('public/og/calibrafacil-cover.png'),
    tempOutput: '/tmp/calibrafacil-cover-banner.raw.png',
  },
]

// The brand banner is a single design (no dark/light variant); keep the
// historical filenames as aliases so any cached or external references to
// them resolve to the current cover.
const aliases = [
  resolve('public/og/calibrafacil-cover-dark.png'),
  resolve('public/og/calibrafacil-cover-light.png'),
]

function findBrowser() {
  for (const candidate of browserCandidates) {
    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    if (result.status === 0) {
      return candidate
    }
  }

  throw new Error(
    'Could not find a Chromium-compatible browser to render the OG image.',
  )
}

function runOrThrow(command, args, label) {
  const result = spawnSync(command, args, { stdio: 'inherit' })

  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.status ?? 'unknown'}.`,
    )
  }
}

const browser = findBrowser()

for (const job of jobs) {
  runOrThrow(
    browser,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=09090B',
      `--window-size=${WIDTH},${CHROMIUM_VIEWPORT_HEIGHT}`,
      '--virtual-time-budget=1000',
      `--screenshot=${job.tempOutput}`,
      `file://${job.input}`,
    ],
    `OG render for ${job.output}`,
  )

  runOrThrow(
    'magick',
    [job.tempOutput, '-crop', `${WIDTH}x${HEIGHT}+0+0`, '+repage', job.output],
    `OG crop for ${job.output}`,
  )
}

for (const alias of aliases) {
  runOrThrow(
    'cp',
    [resolve('public/og/calibrafacil-cover.png'), alias],
    `OG alias copy for ${alias}`,
  )
}
