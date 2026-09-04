/**
 * What the user answered in the signing prompt.
 *
 * `remember` turns a one-off answer into a stored permission, and `duration`
 * bounds it — so this shape is the difference between allowing one signature
 * and allowing every future one. It was declared twice, in the window that
 * raises the question and the row that collects the answer.
 */
export interface PromptDecision {
  allow: boolean;
  remember: boolean;
  /** Milliseconds the decision stands for; omitted means indefinitely. */
  duration?: number;
}
