import {
  RESEARCH_QUALITY_BENCHMARK_VERSION,
  RESEARCH_QUALITY_EVALUATOR_VERSION,
  RESEARCH_QUALITY_GATE_VERSION,
  evaluateResearchQuality,
  evaluateResearchQualityGate
} from '@appsea/research'

const metrics = evaluateResearchQuality()
const qualityGate = evaluateResearchQualityGate(metrics)

console.log(
  JSON.stringify(
    {
      benchmarkVersion: RESEARCH_QUALITY_BENCHMARK_VERSION,
      evaluatorVersion: RESEARCH_QUALITY_EVALUATOR_VERSION,
      gateVersion: RESEARCH_QUALITY_GATE_VERSION,
      qualityGate,
      metrics
    },
    null,
    2
  )
)

if (qualityGate.status === 'fail') process.exitCode = 1
