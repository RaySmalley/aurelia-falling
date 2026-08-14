import type {
  StructureId,
  StructureSnapshot,
  UnitId,
  UnitSnapshot,
} from "./types";

export const RENDER_DELTA_PROTOCOL_VERSION = 1 as const;
export const UNIT_HOT_FIELD_STRIDE = 5;
export const STRUCTURE_HOT_FIELD_STRIDE = 2;

export type RenderUnitSnapshot = Readonly<
  Omit<
    UnitSnapshot,
    "position" | "path" | "health" | "cooldownTicks" | "cargo"
  > & {
    position: Readonly<{ x: number; y: number }>;
    /** Route overlays only need paths for selected units. */
    path: UnitSnapshot["path"];
    health: number;
    cooldownTicks: number;
    cargo: number;
  }
>;

export type RenderStructureSnapshot = Readonly<
  Omit<StructureSnapshot, "health" | "constructionRemainingTicks" | "queue"> & {
    health: number;
    constructionRemainingTicks: number;
  }
>;

export type RenderUnitMetadataSnapshot = Omit<
  RenderUnitSnapshot,
  "position" | "health" | "cooldownTicks" | "cargo"
>;

export type RenderStructureMetadataSnapshot = Omit<
  RenderStructureSnapshot,
  "health" | "constructionRemainingTicks"
>;

export type RenderDeltaLifecycle = Readonly<{
  destroyedUnitIds?: readonly UnitId[];
  destroyedStructureIds?: readonly StructureId[];
}>;

export type RenderEntityDelta<Entity, Update = Entity> = Readonly<{
  create: readonly Entity[];
  update: readonly Update[];
  hide: Uint32Array;
  reveal: readonly Entity[];
  destroy: Uint32Array;
}>;

export type RenderSnapshotDelta = Readonly<{
  protocolVersion: typeof RENDER_DELTA_PROTOCOL_VERSION;
  sequence: number;
  baseSequence: number | null;
  tick: number;
  units: RenderEntityDelta<
    RenderUnitSnapshot,
    RenderUnitMetadataSnapshot
  > &
    Readonly<{
      hotIds: Uint32Array;
      /** x, y, health, cooldownTicks, cargo */
      hotValues: Float64Array;
    }>;
  structures: RenderEntityDelta<
    RenderStructureSnapshot,
    RenderStructureMetadataSnapshot
  > &
    Readonly<{
      hotIds: Uint32Array;
      /** health, constructionRemainingTicks */
      hotValues: Float64Array;
    }>;
}>;

type RenderSnapshotSource = Readonly<{
  tick: number;
  units: readonly UnitSnapshot[];
  structures: readonly StructureSnapshot[];
}>;

const pointEqual = (
  left: Readonly<{ x: number; y: number }> | null,
  right: Readonly<{ x: number; y: number }> | null,
) => left === right || (!!left && !!right && left.x === right.x && left.y === right.y);

const pathEqual = (
  left: UnitSnapshot["path"],
  right: UnitSnapshot["path"],
) =>
  left === right ||
  (left.length === right.length &&
    left.every((point, index) => pointEqual(point, right[index])));

const renderPath = (unit: UnitSnapshot) => (unit.selected ? unit.path : []);

const unitMetadataEqual = (
  left: RenderUnitSnapshot,
  right: RenderUnitSnapshot,
) =>
  left.callsign === right.callsign &&
  left.playerId === right.playerId &&
  left.kind === right.kind &&
  left.displayName === right.displayName &&
  left.armor === right.armor &&
  left.formationId === right.formationId &&
  pointEqual(left.destination, right.destination) &&
  left.selected === right.selected &&
  left.order === right.order &&
  left.pathingState === right.pathingState &&
  pathEqual(left.path, renderPath(right)) &&
  left.maxHealth === right.maxHealth &&
  left.weaponId === right.weaponId &&
  left.targetId === right.targetId &&
  left.targetStructureId === right.targetStructureId &&
  left.cargoCapacity === right.cargoCapacity;

const unitHotEqual = (left: RenderUnitSnapshot, right: RenderUnitSnapshot) =>
  pointEqual(left.position, right.position) &&
  left.health === right.health &&
  left.cooldownTicks === right.cooldownTicks &&
  left.cargo === right.cargo;

const structureMetadataEqual = (
  left: RenderStructureSnapshot,
  right: RenderStructureSnapshot,
) =>
  left.playerId === right.playerId &&
  left.kind === right.kind &&
  left.displayName === right.displayName &&
  pointEqual(left.tile, right.tile) &&
  left.selected === right.selected &&
  left.maxHealth === right.maxHealth &&
  left.constructionTotalTicks === right.constructionTotalTicks &&
  left.completed === right.completed &&
  left.powered === right.powered &&
  left.connected === right.connected &&
  left.repairing === right.repairing &&
  left.powerGenerated === right.powerGenerated &&
  left.powerConsumed === right.powerConsumed &&
  left.buildRadius === right.buildRadius;

const structureHotEqual = (
  left: RenderStructureSnapshot,
  right: RenderStructureSnapshot,
) =>
  left.health === right.health &&
  left.constructionRemainingTicks === right.constructionRemainingTicks;

const toRenderUnit = (unit: UnitSnapshot): RenderUnitSnapshot => {
  const { path, ...renderUnit } = unit;
  return { ...renderUnit, path: unit.selected ? path : [] };
};

const toRenderStructure = (
  structure: StructureSnapshot,
): RenderStructureSnapshot => {
  const { queue: _queue, ...renderStructure } = structure;
  void _queue;
  return renderStructure;
};

const toUnitMetadata = (
  unit: RenderUnitSnapshot,
): RenderUnitMetadataSnapshot => {
  const {
    position: _position,
    health: _health,
    cooldownTicks: _cooldownTicks,
    cargo: _cargo,
    ...metadata
  } = unit;
  void [_position, _health, _cooldownTicks, _cargo];
  return metadata;
};

const toStructureMetadata = (
  structure: RenderStructureSnapshot,
): RenderStructureMetadataSnapshot => {
  const {
    health: _health,
    constructionRemainingTicks: _constructionRemainingTicks,
    ...metadata
  } = structure;
  void [_health, _constructionRemainingTicks];
  return metadata;
};

const sortedIds = (ids: Iterable<number>) =>
  Uint32Array.from([...ids].sort((left, right) => left - right));

export class RenderSnapshotDeltaEncoder {
  private sequence = 0;
  private readonly units = new Map<UnitId, RenderUnitSnapshot>();
  private readonly visibleUnits = new Set<UnitId>();
  private readonly structures = new Map<StructureId, RenderStructureSnapshot>();
  private readonly visibleStructures = new Set<StructureId>();

  reset() {
    this.sequence = 0;
    this.units.clear();
    this.visibleUnits.clear();
    this.structures.clear();
    this.visibleStructures.clear();
  }

  encode(
    snapshot: RenderSnapshotSource,
    lifecycle: RenderDeltaLifecycle = {},
  ): RenderSnapshotDelta {
    const baseSequence = this.sequence === 0 ? null : this.sequence;
    const sequence = this.sequence + 1;
    const destroyedUnitIds = new Set(lifecycle.destroyedUnitIds ?? []);
    const destroyedStructureIds = new Set(
      lifecycle.destroyedStructureIds ?? [],
    );
    const nextUnitIds = new Set(snapshot.units.map((unit) => unit.id));
    const nextStructureIds = new Set(
      snapshot.structures.map((structure) => structure.id),
    );
    const unitCreate: RenderUnitSnapshot[] = [];
    const unitUpdate: RenderUnitMetadataSnapshot[] = [];
    const unitReveal: RenderUnitSnapshot[] = [];
    const unitHide: UnitId[] = [];
    const unitDestroy: UnitId[] = [];
    const unitHotIds: UnitId[] = [];
    const unitHotValues: number[] = [];
    const structureCreate: RenderStructureSnapshot[] = [];
    const structureUpdate: RenderStructureMetadataSnapshot[] = [];
    const structureReveal: RenderStructureSnapshot[] = [];
    const structureHide: StructureId[] = [];
    const structureDestroy: StructureId[] = [];
    const structureHotIds: StructureId[] = [];
    const structureHotValues: number[] = [];

    for (const id of destroyedUnitIds) {
      if (nextUnitIds.has(id)) {
        throw new Error(`Destroyed unit ${id} is still present in the snapshot.`);
      }
      if (!this.units.has(id)) continue;
      unitDestroy.push(id);
      this.units.delete(id);
      this.visibleUnits.delete(id);
    }
    for (const id of this.visibleUnits) {
      if (nextUnitIds.has(id)) continue;
      unitHide.push(id);
      this.visibleUnits.delete(id);
    }
    for (const unit of snapshot.units) {
      const previous = this.units.get(unit.id);
      if (!previous) {
        const next = toRenderUnit(unit);
        unitCreate.push(next);
        this.units.set(unit.id, next);
      } else if (!this.visibleUnits.has(unit.id)) {
        const next = toRenderUnit(unit);
        unitReveal.push(next);
        this.units.set(unit.id, next);
      } else {
        const metadataChanged = !unitMetadataEqual(previous, unit);
        const hotChanged = !unitHotEqual(previous, unit);
        if (metadataChanged || hotChanged) {
          const next = toRenderUnit(unit);
          if (metadataChanged) unitUpdate.push(toUnitMetadata(next));
          this.units.set(unit.id, next);
        }
        if (hotChanged) {
          unitHotIds.push(unit.id);
          unitHotValues.push(
            unit.position.x,
            unit.position.y,
            unit.health,
            unit.cooldownTicks,
            unit.cargo,
          );
        }
      }
      this.visibleUnits.add(unit.id);
    }

    for (const id of destroyedStructureIds) {
      if (nextStructureIds.has(id)) {
        throw new Error(`Destroyed structure ${id} is still present in the snapshot.`);
      }
      if (!this.structures.has(id)) continue;
      structureDestroy.push(id);
      this.structures.delete(id);
      this.visibleStructures.delete(id);
    }
    for (const id of this.visibleStructures) {
      if (nextStructureIds.has(id)) continue;
      structureHide.push(id);
      this.visibleStructures.delete(id);
    }
    for (const structure of snapshot.structures) {
      const previous = this.structures.get(structure.id);
      if (!previous) {
        const next = toRenderStructure(structure);
        structureCreate.push(next);
        this.structures.set(structure.id, next);
      } else if (!this.visibleStructures.has(structure.id)) {
        const next = toRenderStructure(structure);
        structureReveal.push(next);
        this.structures.set(structure.id, next);
      } else {
        const metadataChanged = !structureMetadataEqual(previous, structure);
        const hotChanged = !structureHotEqual(previous, structure);
        if (metadataChanged || hotChanged) {
          const next = toRenderStructure(structure);
          if (metadataChanged) {
            structureUpdate.push(toStructureMetadata(next));
          }
          this.structures.set(structure.id, next);
        }
        if (hotChanged) {
          structureHotIds.push(structure.id);
          structureHotValues.push(
            structure.health,
            structure.constructionRemainingTicks,
          );
        }
      }
      this.visibleStructures.add(structure.id);
    }

    this.sequence = sequence;
    return {
      protocolVersion: RENDER_DELTA_PROTOCOL_VERSION,
      sequence,
      baseSequence,
      tick: snapshot.tick,
      units: {
        create: unitCreate,
        update: unitUpdate,
        hide: sortedIds(unitHide),
        reveal: unitReveal,
        destroy: sortedIds(unitDestroy),
        hotIds: Uint32Array.from(unitHotIds),
        hotValues: Float64Array.from(unitHotValues),
      },
      structures: {
        create: structureCreate,
        update: structureUpdate,
        hide: sortedIds(structureHide),
        reveal: structureReveal,
        destroy: sortedIds(structureDestroy),
        hotIds: Uint32Array.from(structureHotIds),
        hotValues: Float64Array.from(structureHotValues),
      },
    };
  }
}

export class RenderSnapshotDeltaStore {
  private sequence = 0;
  private tick = 0;
  private readonly units = new Map<UnitId, RenderUnitSnapshot>();
  private readonly visibleUnits = new Set<UnitId>();
  private readonly structures = new Map<StructureId, RenderStructureSnapshot>();
  private readonly visibleStructures = new Set<StructureId>();

  apply(delta: RenderSnapshotDelta) {
    if (delta.protocolVersion !== RENDER_DELTA_PROTOCOL_VERSION) {
      throw new Error(`Unsupported render delta protocol ${delta.protocolVersion}.`);
    }
    if (delta.baseSequence === null && delta.sequence === 1 && this.sequence > 0) {
      this.reset();
    }
    const expectedBase = this.sequence === 0 ? null : this.sequence;
    if (delta.baseSequence !== expectedBase || delta.sequence !== this.sequence + 1) {
      throw new Error(
        `Render delta sequence gap: expected ${this.sequence + 1} from ${String(expectedBase)}, received ${delta.sequence} from ${String(delta.baseSequence)}.`,
      );
    }
    if (delta.units.hotValues.length !== delta.units.hotIds.length * UNIT_HOT_FIELD_STRIDE) {
      throw new Error("Invalid packed unit delta length.");
    }
    if (
      delta.structures.hotValues.length !==
      delta.structures.hotIds.length * STRUCTURE_HOT_FIELD_STRIDE
    ) {
      throw new Error("Invalid packed structure delta length.");
    }

    this.applyEntities(
      delta.units,
      this.units,
      this.visibleUnits,
      (unit, metadata) => ({ ...unit, ...metadata }),
    );
    this.applyEntities(
      delta.structures,
      this.structures,
      this.visibleStructures,
      (structure, metadata) => ({ ...structure, ...metadata }),
    );
    delta.units.hotIds.forEach((id, index) => {
      const unit = this.units.get(id);
      if (!unit) throw new Error(`Unit ${id} received a hot update before creation.`);
      const offset = index * UNIT_HOT_FIELD_STRIDE;
      this.units.set(id, {
        ...unit,
        position: {
          x: delta.units.hotValues[offset],
          y: delta.units.hotValues[offset + 1],
        },
        health: delta.units.hotValues[offset + 2],
        cooldownTicks: delta.units.hotValues[offset + 3],
        cargo: delta.units.hotValues[offset + 4],
      });
    });
    delta.structures.hotIds.forEach((id, index) => {
      const structure = this.structures.get(id);
      if (!structure) {
        throw new Error(`Structure ${id} received a hot update before creation.`);
      }
      const offset = index * STRUCTURE_HOT_FIELD_STRIDE;
      this.structures.set(id, {
        ...structure,
        health: delta.structures.hotValues[offset],
        constructionRemainingTicks:
          delta.structures.hotValues[offset + 1],
      });
    });
    this.sequence = delta.sequence;
    this.tick = delta.tick;
    return this.snapshot();
  }

  snapshot() {
    return {
      sequence: this.sequence,
      tick: this.tick,
      units: [...this.visibleUnits]
        .sort((left, right) => left - right)
        .map((id) => this.units.get(id)!),
      structures: [...this.visibleStructures]
        .sort((left, right) => left - right)
        .map((id) => this.structures.get(id)!),
    } as const;
  }

  private reset() {
    this.sequence = 0;
    this.tick = 0;
    this.units.clear();
    this.visibleUnits.clear();
    this.structures.clear();
    this.visibleStructures.clear();
  }

  private applyEntities<
    Id extends number,
    Entity extends Readonly<{ id: Id }>,
    Update extends Readonly<{ id: Id }>,
  >(
    delta: RenderEntityDelta<Entity, Update>,
    entities: Map<Id, Entity>,
    visible: Set<Id>,
    merge: (entity: Entity, update: Update) => Entity,
  ) {
    for (const entity of delta.create) {
      if (entities.has(entity.id)) throw new Error(`Entity ${entity.id} already exists.`);
      entities.set(entity.id, entity);
      visible.add(entity.id);
    }
    for (const update of delta.update) {
      const entity = entities.get(update.id);
      if (!entity) throw new Error(`Entity ${update.id} cannot be updated.`);
      if (!visible.has(update.id)) {
        throw new Error(`Hidden entity ${update.id} cannot be updated before reveal.`);
      }
      entities.set(update.id, merge(entity, update));
    }
    for (const id of delta.hide) visible.delete(id as Id);
    for (const entity of delta.reveal) {
      if (!entities.has(entity.id)) throw new Error(`Entity ${entity.id} cannot be revealed.`);
      entities.set(entity.id, entity);
      visible.add(entity.id);
    }
    for (const id of delta.destroy) {
      entities.delete(id as Id);
      visible.delete(id as Id);
    }
  }
}
