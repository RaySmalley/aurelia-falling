export type PresentationEffectPriority = "essential" | "low";

export class PresentationEffectBudget {
  private lowPriorityRemaining = 0;

  constructor(private readonly lowPriorityCapacity: number) {
    this.reset();
  }

  reset() {
    this.lowPriorityRemaining = Math.max(
      0,
      Math.floor(
        Number.isFinite(this.lowPriorityCapacity)
          ? this.lowPriorityCapacity
          : 0,
      ),
    );
  }

  admit(priority: PresentationEffectPriority) {
    if (priority === "essential") return true;
    if (this.lowPriorityRemaining === 0) return false;
    this.lowPriorityRemaining -= 1;
    return true;
  }
}
