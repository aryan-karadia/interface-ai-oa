import { type ArtifactSpec, ArtifactSpecSchema } from "./artifact.schema";

export interface ValidationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  artifact?: ArtifactSpec;
}

/**
 * Validates an artifact specification for both structural schema compliance
 * and deeper semantic consistency (unique IDs, parameter references, targeting rules).
 */
export function validateArtifact(rawArtifact: unknown): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const parseResult = ArtifactSpecSchema.safeParse(rawArtifact);

  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push({
        severity: "error",
        path: issue.path.join("."),
        message: issue.message,
      });
    }
    return { valid: false, errors, warnings };
  }

  const artifact = parseResult.data;

  // Semantic Rule 1: Step IDs must be unique
  const stepIds = new Set<string>();
  for (let i = 0; i < artifact.steps.length; i++) {
    const step = artifact.steps[i];
    if (stepIds.has(step.id)) {
      errors.push({
        severity: "error",
        path: `steps[${i}].id`,
        message: `Duplicate step ID: "${step.id}"`,
      });
    }
    stepIds.add(step.id);
  }

  // Semantic Rule 2: Verify parameter references in step templates (e.g. {{inputs.paramName}})
  const declaredInputKeys = new Set(Object.keys(artifact.inputs));
  const paramTemplateRegex = /\{\{\s*inputs\.([a-zA-Z0-9_]+)\s*\}\}/g;

  artifact.steps.forEach((step, index) => {
    if (step.action.type === "fill") {
      let match = paramTemplateRegex.exec(step.action.valueTemplate);
      while (match !== null) {
        const referencedParam = match[1];
        if (!declaredInputKeys.has(referencedParam)) {
          errors.push({
            severity: "error",
            path: `steps[${index}].action.valueTemplate`,
            message: `Template references undeclared input parameter: "${referencedParam}"`,
          });
        }
        match = paramTemplateRegex.exec(step.action.valueTemplate);
      }
    }
  });

  // Semantic Rule 3: Interactive actions must have a targeting strategy
  const actionsRequiringTargeting = new Set(["click", "fill", "select", "hover", "extract"]);
  artifact.steps.forEach((step, index) => {
    if (actionsRequiringTargeting.has(step.action.type) && !step.targeting) {
      errors.push({
        severity: "error",
        path: `steps[${index}].targeting`,
        message: `Action type "${step.action.type}" requires a targeting strategy`,
      });
    }

    if (step.targeting) {
      const hasStrategy =
        Boolean(step.targeting.semantic) ||
        Boolean(step.targeting.anchor) ||
        Boolean(step.targeting.structural) ||
        Boolean(step.targeting.visualFallback);
      if (!hasStrategy) {
        errors.push({
          severity: "error",
          path: `steps[${index}].targeting`,
          message: `Targeting strategy on step "${step.id}" must define at least one tier (semantic, anchor, structural, or visualFallback)`,
        });
      }
    }
  });

  // Semantic Rule 4: Output extraction must refer to valid steps
  for (const [outputKey, outputDef] of Object.entries(artifact.outputs)) {
    if (!stepIds.has(outputDef.sourceStepId)) {
      warnings.push({
        severity: "warning",
        path: `outputs.${outputKey}.sourceStepId`,
        message: `Output references step "${outputDef.sourceStepId}" which does not exist in steps array`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    artifact: errors.length === 0 ? artifact : undefined,
  };
}
