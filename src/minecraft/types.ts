export enum BlockType {
  AIR = 0,
  GRASS = 1,
  DIRT = 2,
  STONE = 3,
  WOOD = 4,
  LEAVES = 5,
  WATER = 6,
}

export interface BlockInfo {
  id: BlockType;
  name: string;
  color: number;
  topColor?: number;
  sideColor?: number;
  solid: boolean;
}

export const BLOCK_DEFINITIONS: Record<BlockType, BlockInfo> = {
  [BlockType.AIR]: { id: BlockType.AIR, name: 'Air', color: 0x000000, solid: false },
  [BlockType.GRASS]: { id: BlockType.GRASS, name: 'Grass', color: 0x4ade80, topColor: 0x22c55e, sideColor: 0x854d0e, solid: true },
  [BlockType.DIRT]: { id: BlockType.DIRT, name: 'Dirt', color: 0x854d0e, solid: true },
  [BlockType.STONE]: { id: BlockType.STONE, name: 'Stone', color: 0x64748b, solid: true },
  [BlockType.WOOD]: { id: BlockType.WOOD, name: 'Wood', color: 0xa16207, solid: true },
  [BlockType.LEAVES]: { id: BlockType.LEAVES, name: 'Leaves', color: 0x15803d, solid: true },
  [BlockType.WATER]: { id: BlockType.WATER, name: 'Water', color: 0x3b82f6, solid: false },
};

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface PlayerVoxelState {
  position: Vector3D;
  velocity: Vector3D;
  rotation: { yaw: number; pitch: number };
  isGrounded: boolean;
  selectedBlockType: BlockType;
  selectedBlockName: string;
  lookingAt: {
    hit: boolean;
    blockPos?: Vector3D;
    blockType?: BlockType;
    blockName?: string;
    placePos?: Vector3D;
  };
}

export interface VoxelWorldState {
  totalBlocks: number;
  blockCounts: Record<string, number>;
  bounds: {
    min: Vector3D;
    max: Vector3D;
  };
}

export interface MinecraftSceneState {
  timestamp: number;
  stepCount: number;
  playerState: PlayerVoxelState;
  worldState: VoxelWorldState;
}

export type MinecraftInputAction =
  | 'move_forward'
  | 'move_backward'
  | 'move_left'
  | 'move_right'
  | 'jump'
  | 'break_block'
  | 'place_block'
  | 'select_slot_1'
  | 'select_slot_2'
  | 'select_slot_3'
  | 'select_slot_4'
  | 'stop';
