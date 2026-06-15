import type { BlockFlags } from 'deepslate/render'

const SEMI_TRANSPARENT = new Set([
  'glass', 'glass_pane',
  'white_stained_glass', 'orange_stained_glass', 'magenta_stained_glass',
  'light_blue_stained_glass', 'yellow_stained_glass', 'lime_stained_glass',
  'pink_stained_glass', 'gray_stained_glass', 'light_gray_stained_glass',
  'cyan_stained_glass', 'purple_stained_glass', 'blue_stained_glass',
  'brown_stained_glass', 'green_stained_glass', 'red_stained_glass',
  'black_stained_glass', 'tinted_glass',
  'white_stained_glass_pane', 'orange_stained_glass_pane', 'magenta_stained_glass_pane',
  'light_blue_stained_glass_pane', 'yellow_stained_glass_pane', 'lime_stained_glass_pane',
  'pink_stained_glass_pane', 'gray_stained_glass_pane', 'light_gray_stained_glass_pane',
  'cyan_stained_glass_pane', 'purple_stained_glass_pane', 'blue_stained_glass_pane',
  'brown_stained_glass_pane', 'green_stained_glass_pane', 'red_stained_glass_pane',
  'black_stained_glass_pane',
  'ice', 'blue_ice', 'packed_ice',
  'honey_block', 'slime_block',
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
  'acacia_leaves', 'dark_oak_leaves', 'azalea_leaves', 'cherry_leaves',
  'mangrove_leaves', 'pale_oak_leaves',
  'water', 'bubble_column',
])

const NOT_OPAQUE = new Set([
  'air', 'cave_air', 'void_air',
  'redstone_wire', 'redstone_wall_torch', 'redstone_torch',
  'lever', 'button', 'oak_button', 'stone_button',
  'repeater', 'comparator',
  'powered_rail', 'detector_rail', 'rail', 'activator_rail',
  'torch', 'wall_torch',
  'sign', 'wall_sign', 'dark_oak_wall_sign',
])

export function getBlockFlags(blockName: string): BlockFlags | null {
  if (SEMI_TRANSPARENT.has(blockName)) {
    return { opaque: false, semi_transparent: true, self_culling: true }
  }
  if (NOT_OPAQUE.has(blockName)) {
    return { opaque: false }
  }
  return null
}
