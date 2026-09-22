/**
 * `AgentRun` — encapsulates one agent run: its state, the signal/query handlers, and the
 * phase pipeline. Created fresh per workflow execution (so it stays deterministic). Activities
 * are injected into `execute()` rather than proxied here, which keeps the class decoupled from
 * the Temporal worker wiring and directly testable with fake activities.
 *
 * State machine (SPEC §6): plan → await approval → (reject → re-plan, up to MAX_REJECTIONS) →
 * execute steps → synthesize → complete. A `cancel` signal ends the run from any wait point.
 */

import { condition, log } from '@temporalio/workflow';

import type { AgentState, Plan, StepResult } from '../domain';
import {
  ApprovePlanInputSchema,
  GuidanceSchema,
  type AgentResult,
  type ApprovePlanInput,
} from './contracts';
import type { AiToolsActivities } from './ports';

/** Max plan rejections before the run ends as `rejected`. */
const MAX_REJECTIONS = 3;

type PlanOutcome = 'approved' | 'rejected' | 'cancelled';
type StepOutcome = 'ran' | 'cancelled';

export class AgentRun {
  private status: AgentState['status'] = 'planning';
  private revision = 0;
  private plan?: Plan;
  private finalAnswer?: string;
  // Reset to `undefined` at runtime → declared with explicit `| undefined`
  // (exactOptionalPropertyTypes forbids assigning undefined to a `?:` field).
  private currentStepId: number | undefined;
  private readonly results: StepResult[] = [];
  private readonly guidance: string[] = [];

  private pendingApproval: ApprovePlanInput | undefined;
  private cancelled = false;
  private rejections = 0;
  private feedback: string | undefined;

  constructor(private readonly topic: string) {}

  /** Read-only snapshot for the `getState` query. */
  snapshot(): AgentState {
    return {
      status: this.status,
      topic: this.topic,
      revision: this.revision,
      results: [...this.results],
      guidance: [...this.guidance],
      ...(this.plan ? { plan: this.plan } : {}),
      ...(this.currentStepId !== undefined ? { currentStepId: this.currentStepId } : {}),
      ...(this.finalAnswer !== undefined ? { finalAnswer: this.finalAnswer } : {}),
    };
  }

  /** `approvePlan` signal: accept the latest decision, if valid and currently awaiting one. */
  approve(raw: ApprovePlanInput): void {
    const parsed = ApprovePlanInputSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn('Ignoring invalid approvePlan payload', { issues: parsed.error.issues });
      return;
    }
    if (this.status !== 'awaiting_approval') {
      log.warn('Ignoring approvePlan received outside awaiting_approval', { status: this.status });
      return;
    }
    this.pendingApproval = parsed.data;
  }

  /** `provideGuidance` signal: append non-empty guidance for subsequent steps. */
  addGuidance(raw: string): void {
    const parsed = GuidanceSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn('Ignoring invalid guidance payload');
      return;
    }
    this.guidance.push(parsed.data);
  }

  /** `cancel` signal: request a graceful stop. */
  cancel(): void {
    this.cancelled = true;
  }

  /** Drive the run to a terminal result, using the injected activities. */
  async execute(activities: AiToolsActivities): Promise<AgentResult> {
    log.info('Agent run started', { topic: this.topic });
    const planning = await this.planUntilApproved(activities);
    if (planning !== 'approved') {
      return this.finish(planning);
    }

    if ((await this.runSteps(activities)) === 'cancelled') {
      return this.finish('cancelled');
    }

    await this.synthesizeAnswer(activities);
    return this.finish('completed');
  }

  /** Plan, then await approval — re-planning on rejection until approved or the limit is hit. */
  private async planUntilApproved(activities: AiToolsActivities): Promise<PlanOutcome> {
    while (true) {
      this.status = 'planning';
      this.revision += 1;
      this.plan = await activities.planTask(this.topic, this.feedback);
      this.status = 'awaiting_approval';
      log.info('Awaiting plan approval', {
        revision: this.revision,
        steps: this.plan.steps.length,
      });

      await condition(() => this.pendingApproval !== undefined || this.cancelled);
      if (this.cancelled) {
        return 'cancelled';
      }

      const decision = this.consumeApproval();
      if (!decision) {
        continue;
      }
      if (decision.approved) {
        this.status = 'executing';
        log.info('Plan approved; executing');
        return 'approved';
      }

      this.rejections += 1;
      if (this.rejections >= MAX_REJECTIONS) {
        log.info('Rejection limit reached', { rejections: this.rejections });
        return 'rejected';
      }
      log.info('Plan rejected; re-planning', { rejections: this.rejections });
      this.feedback = decision.feedback;
    }
  }

  /** Run each approved step in order, honoring cancellation between steps. */
  private async runSteps(activities: AiToolsActivities): Promise<StepOutcome> {
    const plan = this.plan;
    if (!plan) {
      return 'cancelled';
    }
    for (const step of plan.steps) {
      if (this.cancelled) {
        return 'cancelled';
      }
      this.currentStepId = step.id;
      log.debug('Executing step', { stepId: step.id, tool: step.tool });
      this.results.push(await activities.runTool(step, this.guidance));
    }
    this.currentStepId = undefined;
    return 'ran';
  }

  private async synthesizeAnswer(activities: AiToolsActivities): Promise<void> {
    this.status = 'synthesizing';
    log.info('Synthesizing final answer', { steps: this.results.length });
    this.finalAnswer = await activities.synthesize(this.topic, this.results);
  }

  /** Read-and-clear the latest approval (the method boundary preserves the declared type). */
  private consumeApproval(): ApprovePlanInput | undefined {
    const next = this.pendingApproval;
    this.pendingApproval = undefined;
    return next;
  }

  private finish(status: AgentResult['status']): AgentResult {
    this.status = status;
    log.info('Agent run finished', {
      status,
      revision: this.revision,
      stepCount: this.results.length,
    });
    return {
      status,
      revision: this.revision,
      stepCount: this.results.length,
      ...(this.finalAnswer !== undefined ? { finalAnswer: this.finalAnswer } : {}),
    };
  }
}
