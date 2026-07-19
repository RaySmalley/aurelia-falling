import type {
  ArmorClass,
  BuildingKind,
  GridPoint,
  UnitKind,
  WeaponId,
} from "./types";

export type WeaponDefinition = Readonly<{
  id: WeaponId;
  displayName: string;
  damage: number;
  cooldownTicks: number;
  rangeMilli: number;
  projectileSpeedMilli: number;
  accuracyBasisPoints: number;
  armorMultipliers: Readonly<Record<ArmorClass, number>>;
}>;

export type UnitDefinition = Readonly<{
  id: UnitKind;
  displayName: string;
  maxHealth: number;
  armor: ArmorClass;
  speedMilliPerTick: number;
  visionMilli: number;
  weaponId: WeaponId;
  cost: number;
  buildTicks: number;
  producedAt: BuildingKind;
  prerequisites: readonly BuildingKind[];
  cargoCapacity: number;
}>;

export type BuildingDefinition = Readonly<{
  id: BuildingKind;
  displayName: string;
  maxHealth: number;
  armor: ArmorClass;
  cost: number;
  buildTicks: number;
  prerequisites: readonly BuildingKind[];
  powerGenerated: number;
  powerConsumed: number;
  visionMilli: number;
  buildRadius: number;
  produces: readonly UnitKind[];
  weaponId: WeaponId | null;
}>;

export type AiBuildOrderStep = Readonly<{
  kind: BuildingKind;
  count: number;
}>;

export type AiProfile = Readonly<{
  id: "normal";
  reactionIntervalTicks: number;
  scoutIntervalTicks: number;
  attackIntervalTicks: number;
  attackStartTick: number;
  solarLaunchStartTick: number;
  attackUnitThreshold: number;
  defenseRadiusMilli: number;
  productionQueueTarget: number;
  expansionStartTick: number;
  buildOrder: readonly AiBuildOrderStep[];
  unitMix: readonly UnitKind[];
  scoutWaypoints: readonly GridPoint[];
}>;

const armorMultipliers = (
  infantry: number,
  light: number,
  heavy: number,
  siege: number,
) => ({ infantry, light, heavy, siege });

const weaponDefinitions = {
  miningLaser: {
    id: "miningLaser",
    displayName: "Midas Cutting Beam",
    damage: 18,
    cooldownTicks: 18,
    rangeMilli: 1_800,
    projectileSpeedMilli: 900,
    accuracyBasisPoints: 9_500,
    armorMultipliers: armorMultipliers(1_200, 1_000, 450, 700),
  },
  argusRifle: {
    id: "argusRifle",
    displayName: "Argus Coil Rifle",
    damage: 32,
    cooldownTicks: 12,
    rangeMilli: 3_400,
    projectileSpeedMilli: 850,
    accuracyBasisPoints: 9_100,
    armorMultipliers: armorMultipliers(1_500, 850, 400, 650),
  },
  cyclopsRockets: {
    id: "cyclopsRockets",
    displayName: "Cyclops Rocket Rack",
    damage: 92,
    cooldownTicks: 30,
    rangeMilli: 5_400,
    projectileSpeedMilli: 520,
    accuracyBasisPoints: 8_600,
    armorMultipliers: armorMultipliers(650, 1_250, 1_700, 1_100),
  },
  hermesAutocannon: {
    id: "hermesAutocannon",
    displayName: "Hermes Autocannon",
    damage: 38,
    cooldownTicks: 9,
    rangeMilli: 3_800,
    projectileSpeedMilli: 960,
    accuracyBasisPoints: 8_900,
    armorMultipliers: armorMultipliers(1_250, 1_350, 600, 750),
  },
  atlasCannon: {
    id: "atlasCannon",
    displayName: "Atlas Battle Cannon",
    damage: 125,
    cooldownTicks: 28,
    rangeMilli: 5_700,
    projectileSpeedMilli: 640,
    accuracyBasisPoints: 9_300,
    armorMultipliers: armorMultipliers(850, 1_250, 1_350, 1_000),
  },
  gorgonMortar: {
    id: "gorgonMortar",
    displayName: "Gorgon Siege Mortar",
    damage: 205,
    cooldownTicks: 52,
    rangeMilli: 8_200,
    projectileSpeedMilli: 420,
    accuracyBasisPoints: 8_200,
    armorMultipliers: armorMultipliers(1_000, 900, 1_100, 1_550),
  },
  cerberusPulse: {
    id: "cerberusPulse",
    displayName: "Cerberus Pulse Battery",
    damage: 78,
    cooldownTicks: 20,
    rangeMilli: 6_500,
    projectileSpeedMilli: 760,
    accuracyBasisPoints: 9_400,
    armorMultipliers: armorMultipliers(1_150, 1_200, 950, 900),
  },
} as const satisfies Record<WeaponId, WeaponDefinition>;

const unitDefinitions = {
  midasHarvester: {
    id: "midasHarvester",
    displayName: "Midas Harvester",
    maxHealth: 680,
    armor: "light",
    speedMilliPerTick: 82,
    visionMilli: 6_500,
    weaponId: "miningLaser",
    cost: 900,
    buildTicks: 240,
    producedAt: "refinery",
    prerequisites: ["refinery"],
    cargoCapacity: 500,
  },
  argusRifle: {
    id: "argusRifle",
    displayName: "Argus Rifle Squad",
    maxHealth: 260,
    armor: "infantry",
    speedMilliPerTick: 126,
    visionMilli: 7_000,
    weaponId: "argusRifle",
    cost: 250,
    buildTicks: 90,
    producedAt: "barracks",
    prerequisites: ["barracks"],
    cargoCapacity: 0,
  },
  cyclopsRocket: {
    id: "cyclopsRocket",
    displayName: "Cyclops Rocket Team",
    maxHealth: 235,
    armor: "infantry",
    speedMilliPerTick: 104,
    visionMilli: 7_400,
    weaponId: "cyclopsRockets",
    cost: 450,
    buildTicks: 130,
    producedAt: "barracks",
    prerequisites: ["barracks", "operationsCenter"],
    cargoCapacity: 0,
  },
  hermesScout: {
    id: "hermesScout",
    displayName: "Hermes Scout",
    maxHealth: 340,
    armor: "light",
    speedMilliPerTick: 178,
    visionMilli: 9_200,
    weaponId: "hermesAutocannon",
    cost: 650,
    buildTicks: 150,
    producedAt: "foundry",
    prerequisites: ["foundry"],
    cargoCapacity: 0,
  },
  atlasTank: {
    id: "atlasTank",
    displayName: "Atlas Battle Tank",
    maxHealth: 920,
    armor: "heavy",
    speedMilliPerTick: 78,
    visionMilli: 7_200,
    weaponId: "atlasCannon",
    cost: 1_200,
    buildTicks: 260,
    producedAt: "foundry",
    prerequisites: ["foundry", "operationsCenter"],
    cargoCapacity: 0,
  },
  gorgonWalker: {
    id: "gorgonWalker",
    displayName: "Gorgon Siege Walker",
    maxHealth: 760,
    armor: "siege",
    speedMilliPerTick: 56,
    visionMilli: 9_500,
    weaponId: "gorgonMortar",
    cost: 1_800,
    buildTicks: 360,
    producedAt: "foundry",
    prerequisites: ["foundry", "operationsCenter"],
    cargoCapacity: 0,
  },
} as const satisfies Record<UnitKind, UnitDefinition>;

const buildingDefinitions = {
  citadel: {
    id: "citadel",
    displayName: "Citadel Command Hub",
    maxHealth: 5_000,
    armor: "heavy",
    cost: 0,
    buildTicks: 0,
    prerequisites: [],
    powerGenerated: 20,
    powerConsumed: 0,
    visionMilli: 10_000,
    buildRadius: 8,
    produces: [],
    weaponId: null,
  },
  reactor: {
    id: "reactor",
    displayName: "Prometheus Reactor",
    maxHealth: 1_500,
    armor: "heavy",
    cost: 700,
    buildTicks: 160,
    prerequisites: ["citadel"],
    powerGenerated: 100,
    powerConsumed: 0,
    visionMilli: 5_500,
    buildRadius: 6,
    produces: [],
    weaponId: null,
  },
  refinery: {
    id: "refinery",
    displayName: "Midas Refinery",
    maxHealth: 2_000,
    armor: "heavy",
    cost: 1_500,
    buildTicks: 260,
    prerequisites: ["reactor"],
    powerGenerated: 0,
    powerConsumed: 15,
    visionMilli: 6_000,
    buildRadius: 6,
    produces: ["midasHarvester"],
    weaponId: null,
  },
  barracks: {
    id: "barracks",
    displayName: "Aegis Barracks",
    maxHealth: 1_350,
    armor: "heavy",
    cost: 900,
    buildTicks: 190,
    prerequisites: ["reactor"],
    powerGenerated: 0,
    powerConsumed: 15,
    visionMilli: 6_500,
    buildRadius: 5,
    produces: ["argusRifle", "cyclopsRocket"],
    weaponId: null,
  },
  foundry: {
    id: "foundry",
    displayName: "Vulcan Foundry",
    maxHealth: 2_200,
    armor: "heavy",
    cost: 1_800,
    buildTicks: 300,
    prerequisites: ["reactor", "barracks"],
    powerGenerated: 0,
    powerConsumed: 30,
    visionMilli: 7_000,
    buildRadius: 6,
    produces: ["hermesScout", "atlasTank", "gorgonWalker"],
    weaponId: null,
  },
  operationsCenter: {
    id: "operationsCenter",
    displayName: "Oracle Operations Center",
    maxHealth: 1_600,
    armor: "heavy",
    cost: 2_200,
    buildTicks: 340,
    prerequisites: ["foundry"],
    powerGenerated: 0,
    powerConsumed: 35,
    visionMilli: 12_000,
    buildRadius: 6,
    produces: [],
    weaponId: null,
  },
  turret: {
    id: "turret",
    displayName: "Cerberus Turret",
    maxHealth: 1_250,
    armor: "heavy",
    cost: 800,
    buildTicks: 180,
    prerequisites: ["barracks"],
    powerGenerated: 0,
    powerConsumed: 10,
    visionMilli: 7_000,
    buildRadius: 0,
    produces: [],
    weaponId: "cerberusPulse",
  },
} as const satisfies Record<BuildingKind, BuildingDefinition>;

export const gameData = Object.freeze({
  weapons: Object.freeze(weaponDefinitions),
  units: Object.freeze(unitDefinitions),
  buildings: Object.freeze(buildingDefinitions),
  economy: Object.freeze({
    startingCredits: 4_500,
    harvestAmount: 25,
    harvestIntervalTicks: 10,
    unloadAmountPerTick: 100,
    repairHealthPerCredit: 4,
    productionQueueLimit: 5,
  }),
  solarSpear: Object.freeze({
    chargeTicks: 4_800,
    warningTicks: 80,
    blastRadiusMilli: 5_000,
    damage: 5_000,
  }),
  ai: Object.freeze({
    normal: Object.freeze({
      id: "normal",
      reactionIntervalTicks: 40,
      scoutIntervalTicks: 360,
      attackIntervalTicks: 1_200,
      attackStartTick: 23_000,
      solarLaunchStartTick: 24_000,
      attackUnitThreshold: 6,
      defenseRadiusMilli: 12_000,
      productionQueueTarget: 2,
      expansionStartTick: 2_400,
      buildOrder: Object.freeze([
        Object.freeze({ kind: "barracks", count: 1 }),
        Object.freeze({ kind: "foundry", count: 1 }),
        Object.freeze({ kind: "operationsCenter", count: 1 }),
        Object.freeze({ kind: "reactor", count: 2 }),
        Object.freeze({ kind: "turret", count: 2 }),
      ]),
      unitMix: Object.freeze([
        "argusRifle",
        "argusRifle",
        "hermesScout",
        "cyclopsRocket",
        "atlasTank",
        "argusRifle",
        "gorgonWalker",
      ]),
      scoutWaypoints: Object.freeze(
        [
          { x: 46, y: 44 },
          { x: 40, y: 39 },
          { x: 35, y: 32 },
          { x: 28, y: 31 },
          { x: 21, y: 24 },
          { x: 14, y: 15 },
          { x: 8, y: 9 },
        ].map((point) => Object.freeze(point)),
      ),
    } satisfies AiProfile),
  }),
});
