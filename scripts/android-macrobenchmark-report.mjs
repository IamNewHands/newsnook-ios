#!/usr/bin/env node
/** Summarize complete AndroidX instrumentation results; never invent missing runs. */
import { readFileSync } from 'node:fs'

function parse(path, testName, samplesPath) {
  const log = readFileSync(path, 'utf8')
  if (!log.includes(testName) || !/INSTRUMENTATION_CODE:\s*-1/.test(log) ||
      !/\bOK \(\d+ tests?\)/.test(log) || /FAILURES!!!|INSTRUMENTATION_STATUS_CODE:\s*-[12]\b/.test(log)) {
    throw new Error(`${path}: failed or incomplete ${testName} instrumentation`)
  }
  const get = (type) => {
    const out = {}
    for (const field of ['min', 'median', 'max', 'stddev']) {
      const matches = [...log.matchAll(new RegExp(`INSTRUMENTATION_STATUS: time_to_${type}_display_millis_${field}=([0-9.]+)`, 'g'))]
      const raw = matches.at(-1)?.[1]
      if (!raw) throw new Error(`${path}: missing metric ${type}.${field}`)
      out[field] = Number(raw)
      if (!Number.isFinite(out[field])) throw new Error(`${path}: invalid ${type}.${field}`)
    }
    return out
  }
  const timing = { TTID: get('initial'), TTFD: get('full') }
  for (const metric of Object.values(timing)) {
    if (metric.min <= 0 || metric.min > metric.median || metric.median > metric.max || metric.stddev < 0) {
      throw new Error(`${path}: inconsistent startup timing metrics`)
    }
  }
  if (samplesPath) {
    const data = JSON.parse(readFileSync(samplesPath, 'utf8'))
    const matches = data.benchmarks?.filter(item => item.name === testName)
    if (matches?.length !== 1) throw new Error(`${samplesPath}: missing or ambiguous samples for ${testName}`)
    const benchmark = matches[0]
    for (const [label, name] of [['TTID', 'timeToInitialDisplayMs'], ['TTFD', 'timeToFullDisplayMs']]) {
      const runs = benchmark.metrics?.[name]?.runs
      if (!Array.isArray(runs) || !runs.length || runs.length !== benchmark.repeatIterations ||
          runs.some(value => !Number.isFinite(value) || value <= 0)) {
        throw new Error(`${samplesPath}: incomplete or invalid ${label} samples`)
      }
      const sorted = [...runs].sort((a, b) => a - b)
      const n = sorted.length
      const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      for (const [field, actual] of [['min', sorted[0]], ['median', median], ['max', sorted[n - 1]]]) {
        if (Math.abs(actual - timing[label][field]) > 0.05) {
          throw new Error(`${samplesPath}: ${label} samples do not match the completed instrumentation log`)
        }
      }
      timing[label].n = n
      timing[label].p90 = sorted[Math.ceil(n * 0.9) - 1]
    }
  }
  return {
    ...timing,
    warnings: [...new Set(log.split(/\r?\n/).filter(line =>
      line.includes('Unable to clear Runtime Image') || line.includes('EMULATOR WARNING')))].map(line => line.trim()),
  }
}

if (process.argv.length < 4) {
  console.error('Usage: node scripts/android-macrobenchmark-report.mjs <none.log> <profile.log> [--json] [--samples <none.json> <profile.json>]')
  process.exit(2)
}
try {
  const samplesIndex = process.argv.indexOf('--samples')
  if (samplesIndex !== -1 && (!process.argv[samplesIndex + 2] ||
      process.argv.slice(samplesIndex + 1, samplesIndex + 3).some(value => value.startsWith('--')))) {
    throw new Error('--samples requires the None and Partial JSON artifacts from these exact runs')
  }
  const baseline = parse(process.argv[2], 'startupNoProfile', samplesIndex === -1 ? undefined : process.argv[samplesIndex + 1])
  const compiled = parse(process.argv[3], 'startupWithProfile', samplesIndex === -1 ? undefined : process.argv[samplesIndex + 2])
  const delta = key => {
    const ms = Math.round((compiled[key].median - baseline[key].median) * 100) / 100
    const percent = Math.round((ms / baseline[key].median) * 10000) / 100
    return { ms, percent }
  }
  const report = {
    none: { TTID: baseline.TTID, TTFD: baseline.TTFD },
    partial: { TTID: compiled.TTID, TTFD: compiled.TTFD },
    deltaTTID: delta('TTID'),
    deltaTTFD: delta('TTFD'),
    warnings: [...new Set([...baseline.warnings, ...compiled.warnings])],
    note: 'Descriptive emulator comparison only. Profile effectiveness requires repeated alternating runs on physical devices.',
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    for (const type of ['TTID', 'TTFD']) {
      const diff = report[`delta${type}`]
      console.log(`${type}: None ${baseline[type].median.toFixed(1)}ms, Partial ${compiled[type].median.toFixed(1)}ms, delta ${diff.ms.toFixed(1)}ms (${diff.percent.toFixed(2)}%)`)
      if (baseline[type].n && compiled[type].n) {
        console.log(`  p90: None ${baseline[type].p90.toFixed(1)}ms (n=${baseline[type].n}), Partial ${compiled[type].p90.toFixed(1)}ms (n=${compiled[type].n})`)
      }
    }
    if (report.warnings.length) console.warn(`Warnings: ${report.warnings.length} (ART runtime image may not have been reset)`)
    console.log(report.note)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
