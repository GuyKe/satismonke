import type { Line } from './Narrator';

const V = (text: string): Line => ({ who: 'vesper', text });
const A = (text: string): Line => ({ who: 'alien', text });
type Set = Line[][];

/**
 * Everything VESPER and the thing underneath have to say. Each key holds several variants; the narrator picks one at
 * random (never the same twice in a row) and rate-limits it, so repeated actions do not repeat jokes.
 * VESPER works for Halcyon, a company that has never once admitted fault.
 */
export const D: Record<string, Set> = {
  // ---- the pod ----
  capsuleStart: [[V('Welcome aboard the Halcyon Pioneer Pod. Please keep your hands, feet and expectations inside the vehicle at all times.')]],
  podAlarm: [[V('Thrusters have failed. Emergency brakes are deploying. Halcyon reminds you that the brakes are a subscription feature.'), V('Please remain calm. Calm is mandatory.')]],
  podCrash: [[V('Impact detected. Your survival has been logged as a pleasant surprise.')]],

  // ---- gathering ----
  firstWood: [[V('Wood. A renewable resource, in the sense that you can keep hitting things until it renews.')]],
  chop: [[V('Another tree felled. The forest has filed no complaint. Yet.')], [V('Deforestation is just landscaping with ambition.')], [V('Please do not hug the next one. Hugging is not billable.')], [V('Trees detected: fewer. Productivity detected: more.')]],
  firstStone: [[V('Stone. Hard, grey, and emotionally unavailable, much like management.')]],
  rock: [[V('You are punching a rock. Halcyon has an entire department for that. It is you.')], [V('Boulder demolished. It had a good life. Probably.')], [V('Stone acquired. Please do not skip it across the lake. The lake has a lawyer.')]],
  firstOre: [[V('Ore. Somewhere a geologist is weeping, and it is not Halcyon.')]],
  oreCopper: [[V('Copper. Excellent for wire, and for explaining to children why pennies are different here.')]],
  oreIron: [[V('Iron. The planet had plenty. It is about to have less.')]],
  oreGold: [[V('Gold. Halcyon has no use for it, but would like to keep it anyway.')]],
  orePlasma: [[V('Plasma ore. It glows because it is angry. Please do not ask about what.')]],
  oreUranium: [[V('Uranium. Your hands are now a medical curiosity. Halcyon recommends hazmat. Or a different hobby.')]],
  firstCrystal: [[V('Crystal. Shiny, brittle, and valued far above its usefulness. A perfect Halcyon employee.')]],

  // ---- crafting ----
  craft_campfire: [[V('A campfire. Humanity\'s first technology, and still the best at being on fire.')]],
  craft_pickaxe: [[V('A pickaxe. Halcyon is proud to say it was invented by someone, somewhere.')]],
  craft_axe: [[V('A stone axe. Trees everywhere just felt a chill and do not know why.')]],
  craft_lantern: [[V('A lantern. Now you can be afraid of the dark with better lighting.')]],
  craft_gloves: [[V('Power gloves. Please remember that hitting things harder is not a personality.')]],
  craft_sticky: [[V('Sticky gloves. You can now grip ice. Halcyon cannot grip responsibility, but we are working on it.')]],
  craft_floatcore: [[V('A float core. Gravity has been asked to be less insistent.')]],
  craft_crystalgloves: [[V('Crystal gloves. They are fabulous, and also illegal in three jurisdictions I have invented.')]],
  craft_lamp: [[V('A crystal lamp. It lights the way, and also advertises your location to anything with eyes.')]],
  craft_ironpick: [[V('An iron pickaxe. Ore is now merely a suggestion.')]],
  craft_copperlantern: [[V('A copper lantern. Brighter, and therefore harder to ignore, like me.')]],
  craft_scanner: [[V('Ore scanner online. Knowing where everything is will make the planet feel so much smaller.')]],
  craft_plasmacore: [[V('Plasma core installed. Gravity has stopped taking your calls.')]],
  craft_steelbar: [[V('Steel, from ore. Halcyon is delighted: it means crashed pods are no longer your only source of structural integrity.')], [V('You forged steel. Technically you are now a metallurgist. The union will be in touch.')]],
  craft_pole: [[V('A power pole. Electricity travels along it like gossip along a corridor, and with about the same losses.')]],
  craft_powerline: [[V('Power line tool ready. Connect the burner to a pole, then the pole to your machines. Machines without power are simply very expensive sculptures.')]],
  craft_burner: [[V('A biomass burner. It converts wood into power and smoke into a future problem.')]],
  craft_smelter: [[V('A smelter. Please keep arms, hair and loose commitments away from the furnace.')]],
  craft_constructor: [[V('A constructor. It builds things from other things, which is the entire economy in one sentence.')]],
  craft_storage: [[V('A storage box. Somewhere to put things so you can forget about them, like feelings.')]],
  craft_conveyor: [[V('Conveyor link tool ready. Remember: belts only go one way. So does the company.')]],
  craft_solar: [[V('A solar panel. Free power, whenever the sun feels like it. Saturn does not feel like it at night.')]],
  craft_splitter: [[V('A smart splitter. It sorts by type, unlike management, which sorts by cost.')]],
  craft_sink: [[V('A resource sink. Feed it anything. It does not judge, and it has no feelings to hurt.')]],
  craft_buildtool: [[V('Build tool active. Please do not build anything you could not explain to an inspector.')]],
  craft_beacon: [[V('Signal beacon online. You can now be rescued, ignored, or both.')]],
  craft_solarroof: [[V('Solar roof installed. The Hub is now a very expensive hat that makes electricity.')]],
  craft_overclockst: [[V('Overclock station ready. Machines may now be asked to try harder. They have not been consulted.')]],
  craft_altplate: [[V('Coated plates. Technically the same plates, but with confidence.')]],
  craft_altwire: [[V('Braided wire. Longer, stronger, and still mostly about copper.')]],
  craft_altsmelt: [[V('Fast smelting. The furnace will now work as if its lunch break has been cancelled.')]],
  craft_efficiency: [[V('Efficient motors. Same output, less power. This is what Halcyon calls a miracle and engineers call Tuesday.')]],
  craft_gasmask: [[V('A gas mask. It will protect you from poison clouds and from most small talk.')]],
  craft_hazmat: [[V('A hazmat suit. It will protect you from radiation. It will not protect you from how you look in it.')]],
  craft_bladerunners: [[V('Blade runners. Faster, bouncier, and your knees say thank you. Halcyon does not cover knees.')]],
  craft_reactor: [[V('A nuclear reactor. Halcyon would like to state, for the record, that it is perfectly safe, and has already stated it three times.')]],

  // ---- factory ----
  wired: [[V('Power line connected. Electrons have been informed of their new commute.')], [V('A cable. The most direct way to say "this machine now belongs to the grid".')], [V('Connected. If it still does not work, check the burner. It is always the burner.')]],
  mediaComputer: [[V('A media computer. Music, and videos of yourself. Halcyon would like it noted that it has never seen a monke produce content, only consume it.')]],
  cameraFirst: [[V('A camera. Stand in front of it and press record. Please do not do anything you would not want played back to the entire planet.')]],
  published: [[V('Published. Your video is now available to everyone who matters, and a few who do not.')], [V('Your clip is out there now. Halcyon takes no responsibility for the comments.')]],
  firstBiomass: [[V('Biomass. Leaves, twigs and hope, compressed. Feed it to a burner and it becomes electricity, which is the only honest thing this company has ever made.')]],
  voidFall: [[V('You have fallen into the void. Halcyon has retrieved you at no extra charge. It does not know how, and would rather not discuss it.')], [V('The void is optional scenery. Please stop testing it.')], [V('Bottomless, you say? It was bottomless for about eleven seconds, and then I fetched you.')]],
  burnerFueled: [[V('Fuel loaded. Please stand back. Or forward. Nobody has the data.')]],
  fuelOut: [[V('The burner has gone out. The grid is unimpressed.')], [V('Out of fuel. Wood does not grow on belts, though Halcyon is exploring it.')]],
  powerLow: [[V('Power demand is exceeding supply. Machines are slowing down in solidarity.')], [V('Grid strain detected. Consider a larger generator, or smaller ambitions.')]],
  trip: [[V('Breaker tripped. Statistically, this is the part where you learn about power.')], [V('The grid has fainted. Please reset the breaker and reflect.')], [V('Breaker tripped again. At this point it is less an accident than a lifestyle.')]],
  linkBuilt: [[V('Belt connected. Goods now flow in a single direction, as nature intended.')], [V('A conveyor. The most honest form of transport: it only goes where it is told.')], [V('Linked. Please do not stand on the belt. Please. I have seen the reports.')]],
  firstTokens: [[V('Tokens earned. They are worthless anywhere but here, which is a strong basis for an economy.')]],
  overclockMore: [[V('Clock speed increased. Power draw has increased more. Mathematics is not on your side.')], [V('Overclocked. The machine hums nervously.')]],
  machineRemoved: [[V('Machine dismantled. It served well. It had no choice.')]],

  // ---- building ----
  foundation: [[V('Foundations. Remember: a building is just a very optimistic floor.')]],
  wall: [[V('A wall. Now you have an inside, and everyone else has an outside.')]],
  catwalk: [[V('A catwalk. Please do not strut. The railings were value-engineered.')]],
  demolish: [[V('Demolished. The materials will be recycled as lessons.')]],
  buildMore: [[V('Another piece. Soon it will be a structure, and then a landmark, and then a liability.')], [V('Building noted. The planet is now slightly less planet.')]],

  // ---- the world ----
  sunset: [[V('Saturn is setting. Halcyon reminds you that beauty is subject to terms and conditions.')], [V('The sky has gone pink. Nobody is billing you for it, which is suspicious.')]],
  nightfall: [[V('Night has fallen. Visibility is down, mystery is up. Please enjoy responsibly.')], [V('It is dark now. The creatures that glow are friends. The ones that do not are also friends. Probably.')]],
  sunrise: [[V('Saturn is rising again. Another productive cycle, assuming you survived it.')], [V('Dawn. The planet has been rebooted and nothing has been learned.')]],
  water: [[V('You are in the lake. Halcyon does not recommend this. Halcyon does not recommend most things you do.')]],
  creature: [[V('Local wildlife detected. It is not hostile. It is merely unconvinced.')], [V('The animals have opinions about you. Do not ask for them.')], [V('That sound was biological. I checked.')]],
  roar_serpent: [[V('That was the lake serpent. The pioneer handbook lists this as a "scenic hazard".')]],
  roar_manta: [[V('That was a manta. It is enormous and gentle and above you, which is the correct order of things.')]],
  podFound: [[V('A crashed pod detected nearby. Someone had a worse day than you, which is statistically comforting.')], [V('Another pod beacon. Salvage is not looting. It is looting with paperwork.')]],
  loot: [[V('Another pod. Its previous occupants have been reassigned. Permanently.')], [V('Loot acquired. The pod\'s warranty has been voided. Retroactively.')]],
  lootRare: [[V('A data drive and a core in the same pod. Whoever packed this had a plan. It did not survive.')]],

  // ---- health & hazards ----
  lowHp: [[V('Your vitals are at the stage Halcyon calls "motivational".')], [V('Health low. Please stop doing the thing that is causing it.')]],
  fall: [[V('That landing was recorded for training purposes.')], [V('Gravity has won this round. It is not even trying.')]],
  deaths: [[V('You have died. Halcyon has already hired your replacement. It is you, again.')], [V('Death number noted. Your remains have been recycled, and so has the joke.')], [V('Respawned. The company records this as a very short vacation.')]],

  // ---- first time ----
  map: [[V('Map active. If you get lost, follow the arrow to your Hub. If you get lost from there, that is a personal matter.')]],
  hubEnter: [[V('Welcome home. The Hub has been expecting you, in the sense that it has no choice.')]],
  arcade: [[V('You are playing a game inside a game. Halcyon will not be charging for this. Yet.')]],
  milestoneWood: [[V('Fifty wood collected. You are officially a threat to the local ecosystem.')]],
  milestonePlates: [[V('Fifty plates. That is a lot of plates. Please do not throw them.')]],
  milestoneMachines: [[V('Ten machines operating. You are no longer a pioneer. You are middle management.')]],

  // ---- idle chatter ----
  idleDay: [
    [V('Reminder: Halcyon values your safety at approximately one pod.')],
    [V('Fun fact: the planet has no official name. Halcyon is accepting bribes.')],
    [V('Productivity is up four percent. This is not a measurement, it is a hope.')],
    [V('If you can hear this, the audio system works. Congratulations on being alive enough to hear it.')],
    [V('Please remember to hydrate. I cannot see you, but I can sense the dryness.')],
    [V('Pioneer morale is excellent. The sample size is one, and it is you.')],
    [V('This message has been recorded for quality assurance. The quality is also recorded. It is not good.')],
    [V('Have you tried turning the planet off and on again? Neither have we.')],
  ],
  idleNight: [
    [V('It is dark. Halcyon wishes to remind you that darkness is a lighting issue, not a personal one.')],
    [V('The wisps are only light and gas. Mostly. Please do not follow them.')],
    [V('Nighttime operations are voluntary. Halcyon will quietly note that you volunteered.')],
    [V('If you see something glowing and sentient, it is probably also employed by Halcyon.')],
    [V('Stars detected. Halcyon claims none of them.')],
  ],
  idleFactory: [
    [V('Your factory is running. I would call it efficient, but I have seen the belts.')],
    [V('A small request: please do not look at the spaghetti. It looks back.')],
    [V('Throughput is acceptable. Please do not tell the machines. They get ideas.')],
    [V('Halcyon appreciates your factory. Halcyon would also appreciate a second one.')],
  ],
  idleBuilder: [
    [V('Your structure is load-bearing. I assume. Please do not test the assumption.')],
    [V('I have drawn up a floor plan of your base. It is a circle of confusion.')],
  ],
  alienNight: [
    [A('▒ you walk where we walked ▒')],
    [A('▒ the pods were not accidents ▒')],
    [A('▒ do you hear the lake ▒')],
    [A('▒ stay ▒')],
    [V('Did you hear that?'), V('No. I did not. Halcyon has no record of that. Please carry on.')],
    [A('▒ we are very patient ▒'), V('That is just wind. Wind with excellent diction.')],
  ],

  // ---- artifacts: the story builds ----
  artifact2: [[A('▒ not the first ▒'), V('Please ignore that. Whatever it was, it did not say anything.')]],
  artifact3: [[V('That is three. Please stop collecting them, they are starting to collect you.'), A('▒ the lake remembers you ▒')]],
  artifact5: [[A('▒ we are the ones who stayed ▒'), V('Halcyon wishes to inform you that the alien entity is not on the payroll. This is, regrettably, under review.')]],
  artifact7: [[A('▒ bring them all to the water ▒'), V('I do not like that suggestion. I do not like that anyone suggested it.')]],
};
