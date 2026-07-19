import type {
  ArmorClass,
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
}>;

const weaponDefinitions = {
  miningLaser: {
    id: "miningLaser",
    displayName: "Midas Cutting Beam",
    damage: 18,
    cooldownTicks: 18,
    rangeMilli: 1_800,
    projectileSpeedMilli: 900,
    accuracyBasisPoints: 9_500,
    armorMultipliers: {
      infantry: 1_200,
      light: 1_000,
      heavy: 450,
      siege: 700,
    },
  },
  argusRifle: {
    id: "argusRifle",
    displayName: "Argus Coil Rifle",
    damage: 32,
    cooldownTicks: 12,
    rangeMilli: 3_400,
    projectileSpeedMilli: 850,
    accuracyBasisPoints: 9_100,
    armorMultipliers: {
      infantry: 1_500,
      light: 850,
      heavy: 400,
      siege: 650,
    },
  },
  cyclopsRockets: {
    id: "cyclopsRockets",
    displayName: "Cyclops Rocket Rack",
    damage: 92,
    cooldownTicks: 30,
    rangeMilli: 5_400,
    projectileSpeedMilli: 520,
    accuracyBasisPoints: 8_600,
    armorMultipliers: {
      infantry: 650,
      light: 1_250,
      heavy: 1_700,
      siege: 1_100,
    },
  },
  hermesAutocannon: {
    id: "hermesAutocannon",
    displayName: "Hermes Autocannon",
    damage: 38,
    cooldownTicks: 9,
    rangeMilli: 3_800,
    projectileSpeedMilli: 960,
    accuracyBasisPoints: 8_900,
    armorMultipliers: {
      infantry: 1_250,
      light: 1_350,
      heavy: 600,
      siege: 750,
    },
  },
  atlasCannon: {
    id: "atlasCannon",
    displayName: "Atlas Battle Cannon",
    damage: 125,
    cooldownTicks: 28,
    rangeMilli: 5_700,
    projectileSpeedMilli: 640,
    accuracyBasisPoints: 9_300,
    armorMultipliers: {
      infantry: 850,
      light: 1_250,
      heavy: 1_350,
      siege: 1_000,
    },
  },
  gorgonMortar: {
    id: "gorgonMortar",
    displayName: "Gorgon Siege Mortar",
    damage: 205,
    cooldownTicks: 52,
    rangeMilli: 8_200,
    projectileSpeedMilli: 420,
    accuracyBasisPoints: 8_200,
    armorMultipliers: {
      infantry: 1_000,
      light: 900,
      heavy: 1_100,
      siege: 1_550,
    },
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
  },
  argusRifle: {
    id: "argusRifle",
    displayName: "Argus Rifle Squad",
    maxHealth: 260,
    armor: "infantry",
    speedMilliPerTick: 126,
    visionMilli: 7_000,
    weaponId: "argusRifle",
  },
  cyclopsRocket: {
    id: "cyclopsRocket",
    displayName: "Cyclops Rocket Team",
    maxHealth: 235,
    armor: "infantry",
    speedMilliPerTick: 104,
    visionMilli: 7_400,
    weaponId: "cyclopsRockets",
  },
  hermesScout: {
    id: "hermesScout",
    displayName: "Hermes Scout",
    maxHealth: 340,
    armor: "light",
    speedMilliPerTick: 178,
    visionMilli: 9_200,
    weaponId: "hermesAutocannon",
  },
  atlasTank: {
    id: "atlasTank",
    displayName: "Atlas Battle Tank",
    maxHealth: 920,
    armor: "heavy",
    speedMilliPerTick: 78,
    visionMilli: 7_200,
    weaponId: "atlasCannon",
  },
  gorgonWalker: {
    id: "gorgonWalker",
    displayName: "Gorgon Siege Walker",
    maxHealth: 760,
    armor: "siege",
    speedMilliPerTick: 56,
    visionMilli: 9_500,
    weaponId: "gorgonMortar",
  },
} as const satisfies Record<UnitKind, UnitDefinition>;

export const gameData = Object.freeze({
  weapons: Object.freeze(weaponDefinitions),
  units: Object.freeze(unitDefinitions),
});
