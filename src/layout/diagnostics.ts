import type { MultiscaleDiagnosticsSummary } from "./metrics";

interface MultiscaleDiagnosticsLike {
  method: string;
  verifiedMultiscale: boolean;
  fallbackUsed: boolean;
  effectiveScaleCount: number;
  selectedScaleCount?: number;
  energyThreshold: number;
  scaleBands: Array<{ scale: number; ratio: number }>;
  scaleCoefficients?: Array<{ scale: number; coefficient: number }>;
  objectiveBefore?: number;
  objectiveAfter?: number;
  meanSlopeBefore?: number;
  meanSlopeAfter?: number;
  maxSlopeBefore?: number;
  maxSlopeAfter?: number;
  curvatureBefore?: number;
  curvatureAfter?: number;
  burstBefore?: number;
  burstAfter?: number;
  derivativeConcentrationBefore?: number;
  derivativeConcentrationAfter?: number;
  centerlineSlopeCoverageBefore?: number;
  centerlineSlopeCoverageAfter?: number;
  globalMeanSlopeGuardrailPassed?: boolean;
}

export function toMultiscaleDiagnosticsSummary(
  diagnostics: MultiscaleDiagnosticsLike
): MultiscaleDiagnosticsSummary {
  return {
    method: diagnostics.method,
    verified: diagnostics.verifiedMultiscale,
    fallbackUsed: diagnostics.fallbackUsed,
    effectiveScaleCount: diagnostics.effectiveScaleCount,
    selectedScaleCount: diagnostics.selectedScaleCount,
    threshold: diagnostics.energyThreshold,
    scaleBands: diagnostics.scaleBands.map((band) => ({ scale: band.scale, ratio: band.ratio })),
    scaleCoefficients: diagnostics.scaleCoefficients,
    objectiveBefore: diagnostics.objectiveBefore,
    objectiveAfter: diagnostics.objectiveAfter,
    meanSlopeBefore: diagnostics.meanSlopeBefore,
    meanSlopeAfter: diagnostics.meanSlopeAfter,
    maxSlopeBefore: diagnostics.maxSlopeBefore,
    maxSlopeAfter: diagnostics.maxSlopeAfter,
    curvatureBefore: diagnostics.curvatureBefore,
    curvatureAfter: diagnostics.curvatureAfter,
    burstBefore: diagnostics.burstBefore,
    burstAfter: diagnostics.burstAfter,
    derivativeConcentrationBefore: diagnostics.derivativeConcentrationBefore,
    derivativeConcentrationAfter: diagnostics.derivativeConcentrationAfter,
    centerlineSlopeCoverageBefore: diagnostics.centerlineSlopeCoverageBefore,
    centerlineSlopeCoverageAfter: diagnostics.centerlineSlopeCoverageAfter,
    globalMeanSlopeGuardrailPassed: diagnostics.globalMeanSlopeGuardrailPassed
  };
}
