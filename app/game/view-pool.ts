export class BoundedKeyedPool<Key, Value> {
  private readonly buckets = new Map<Key, Value[]>();
  private pooledCount = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new RangeError("Pool capacity must be a non-negative integer.");
    }
  }

  get size() {
    return this.pooledCount;
  }

  acquire(key: Key) {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.length === 0) return undefined;
    const value = bucket.pop()!;
    this.pooledCount -= 1;
    if (bucket.length === 0) this.buckets.delete(key);
    return value;
  }

  release(key: Key, value: Value) {
    if (this.pooledCount >= this.capacity) return false;
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(value);
    else this.buckets.set(key, [value]);
    this.pooledCount += 1;
    return true;
  }
}
