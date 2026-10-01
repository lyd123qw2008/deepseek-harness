import { valueMap } from '@deepseek-ai/cosmokit'

type LoaderExpressionEvaluator = (ctx: object, expr: string) => any

let expressionEvaluator: LoaderExpressionEvaluator | undefined

/**
 * Evaluate a JavaScript expression against a loader context scope.
 *
 * Host-built browser rosters contain package identities only and never call
 * this evaluator. Keep construction lazy so importing the Loader does not make
 * a renderer's CSP allow `unsafe-eval`; Host-side config expressions still run
 * when the Node Loader explicitly evaluates them.
 */
export function evaluate(ctx: object, expr: string): any {
  if (typeof process === 'undefined' || typeof process.versions?.node !== 'string') {
    throw new Error('loader: !!js expressions are unavailable in browser plugin entries')
  }
  expressionEvaluator ??= new Function('ctx', 'expr', `
    with (ctx) {
      return eval(expr)
    }
  `) as LoaderExpressionEvaluator // eslint-disable-line no-new-func
  return expressionEvaluator(ctx, expr)
}

/** Recursively replace YAML `!!js` expression nodes with evaluated values. */
export function interpolate(ctx: object, value: any) {
  if (isJsExpr(value)) {
    return evaluate(ctx, value.__jsExpr)
  } else if (!value || typeof value !== 'object') {
    return value
  } else if (Array.isArray(value)) {
    return value.map(item => interpolate(ctx, item))
  } else {
    return valueMap(value, item => interpolate(ctx, item))
  }
}

/** Return true when a value is a serialized loader JavaScript expression. */
export function isJsExpr(value: any): value is JsExpr {
  return value instanceof Object && '__jsExpr' in value
}

/** Serialized JavaScript expression produced by the include YAML tag. */
export interface JsExpr {
  __jsExpr: string
}
