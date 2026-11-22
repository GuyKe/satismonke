export const CONTROLS_LINES = [
  'HANDS    Push, swipe and swing off surfaces to move',
  '         (there is no walking or joystick)',
  'GRIP + PUNCH   Break trees, ore, crystals, your pod',
  'TRIGGER  Point at screens and click, or place things',
  'A  Map          X  Crafting          Y  Pause menu',
  'B  Skip the crash scene (pod) / cancel placing',
  '',
  'Desktop test keys:  M map   X craft   Esc menu',
  '                    B skip   G hold = grip   click = use',
];

export const HOWTO_LINES = [
  '1. You crash on an alien planet. Smash your pod',
  '   with grip + punch to salvage steel.',
  '2. Chop trees, break boulders: wood and stone.',
  '3. Press X and craft the Hub, then place it.',
  '4. The Hub has a crafting bench and a computer.',
  '5. Mine copper, iron, gold, crystal and glowing',
  '   plasma ore to unlock better gear.',
  '6. Your right wrist shows what to do next.',
  '7. The creatures are curious or shy. They will',
  '   not hurt you, and they roar now and then.',
];

/** Where to find every resource (the FIND RESOURCES page). */
export const RESOURCE_GUIDE: { name: string; color: string; lines: [string, string] }[] = [
  { name: 'WOOD', color: '#e8b27a', lines: ['Trees all over the plains. Grip + punch a trunk twice', '(once with a Stone Axe). Burn it in a Biomass Burner.'] },
  { name: 'STONE', color: '#c0c4d0', lines: ['Round grey boulders on the plains. Grip + punch them', 'three times (fewer with a pickaxe).'] },
  { name: 'IRON', color: '#8fa6c8', lines: ['Dark rocks with blue-grey crystals, in small veins', 'across the plains. Put a Miner on one to automate it.'] },
  { name: 'COPPER', color: '#e08a3c', lines: ['Dark rocks with orange crystals, in veins on the', 'plains. Same as iron: punch it or mine it with a Miner.'] },
  { name: 'STEEL', color: '#8fc3ff', lines: ['Smash your own crashed pod, or open other crashed', 'pods: red blinking lights, red triangles on the map.'] },
  { name: 'CRYSTAL', color: '#6fe8ff', lines: ['The tall glowing spires in clusters. Grip + punch them', 'twice. Pods sometimes hold a few too.'] },
  { name: 'GOLD', color: '#ffd23a', lines: ['Rare yellow-flecked rocks on the highest hills and', 'ridges, far from where you landed. The Ore Scanner helps.'] },
  { name: 'PLASMA', color: '#d27aff', lines: ['Glowing purple rocks on top of the mesas out in the', 'big lake. You will need Power Gloves and good launches.'] },
  { name: 'URANIUM', color: '#7dff5a', lines: ['Glowing green rocks inside the radiation zones (green', 'GAS/RAD circles on the map). Wear a Hazmat Suit!'] },
  { name: 'PLATE', color: '#e0e6f0', lines: ['Made from iron ingots in a Constructor. Take them from', 'a Storage Box that your belts deliver into.'] },
  { name: 'WIRE', color: '#ff9040', lines: ['Made from copper ingots in a Constructor (2 per ingot,', '3 with Braided Wire research).'] },
  { name: 'TOKEN', color: '#ffd45a', lines: ['Feed anything to a Resource Sink. Spend tokens on new', 'building colours in the Build Tool.'] },
  { name: 'CORE', color: '#ff7aa0', lines: ['Rare loot in crashed pods. Spend one at the Overclock', 'Station upgrade to boost a machine by 50%.'] },
  { name: 'DATA DRIVE', color: '#7affb0', lines: ['Rare loot in crashed pods. Each one unlocks a research', 'recipe at the Hub Research Lab.'] },
  { name: 'ARTIFACT', color: '#c04dff', lines: ['Very rare finds in crashed pods. They do nothing', 'useful... except make something answer back.'] },
];
