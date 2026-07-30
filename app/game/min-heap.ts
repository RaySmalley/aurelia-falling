export class DeterministicMinHeap<Value> {
  private readonly values: Value[] = [];

  constructor(
    private readonly compare: (left: Value, right: Value) => number,
  ) {}

  get size() {
    return this.values.length;
  }

  push(value: Value) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (this.compare(this.values[index], this.values[parent]) >= 0) break;
      [this.values[parent], this.values[index]] = [
        this.values[index],
        this.values[parent],
      ];
      index = parent;
    }
  }

  pop() {
    const first = this.values[0];
    const last = this.values.pop();
    if (this.values.length === 0 || last === undefined) return first;

    this.values[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (
        left < this.values.length &&
        this.compare(this.values[left], this.values[smallest]) < 0
      ) {
        smallest = left;
      }
      if (
        right < this.values.length &&
        this.compare(this.values[right], this.values[smallest]) < 0
      ) {
        smallest = right;
      }
      if (smallest === index) return first;
      [this.values[index], this.values[smallest]] = [
        this.values[smallest],
        this.values[index],
      ];
      index = smallest;
    }
  }
}
