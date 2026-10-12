/**
 * Every explainer in the app, in one place: the short tips behind the ⓘ
 * buttons on fields, the "how do I do this?" for each kind of bake step, and
 * the sections of the guide (#/guide) the tips link to.
 *
 * Written for someone on their first starter. Plain words, one idea per tip,
 * and the numbers match what the app's own model uses (src/fermentation).
 */
import type { StepKind } from "../../src/fermentation/index.js";

export type GuideSection =
  | "starter"
  | "feeding"
  | "ratios"
  | "peak"
  | "fridge"
  | "hydration"
  | "levain"
  | "percentages"
  | "bulk"
  | "shaping"
  | "retard"
  | "baking"
  | "troubleshooting";

export interface Tip {
  /** One to three sentences. */
  text: string;
  /** The guide section that explains it fully. */
  more?: GuideSection;
}

export const TIPS = {
  // ---------- starters ----------
  starterName: {
    text: "Most bakers name their starter. It also tells two jars apart if you keep a rye and a white.",
  },
  starterFlour: {
    text: "What you feed it. Whole grain and rye flours ferment faster and smell sourer; white flour gives a milder, slower starter. Any is fine; just stay consistent.",
    more: "starter",
  },
  starterHydration: {
    text: "Water as a percent of flour in each feed. 100% means equal weights of flour and water, a thick-pancake-batter starter, and is what most recipes assume. Leave it at 100 if you're not sure.",
    more: "hydration",
  },
  reserve: {
    text: "How much starter stays in the jar after you take what a bake needs. It's the seed for the next feed. 20 g is plenty; Crumb adds it to every feed it suggests.",
    more: "feeding",
  },
  location: {
    text: "On the counter a starter is active and needs feeding about once a day. In the fridge it barely ferments and only needs a feed about once a week. Bake often? Counter. Bake on weekends? Fridge.",
    more: "fridge",
  },

  // ---------- feeding ----------
  feedMode: {
    text: "“Ready by a time” works out a feed that peaks when you need it, for a bake. “Just feeding” is a routine feed to keep it healthy.",
    more: "feeding",
  },
  need: {
    text: "How much ripe starter the recipe calls for. When planning a bake, this is the levain amount on the bake's formula.",
    more: "levain",
  },
  kitchenTemp: {
    text: "Warmth is the biggest thing you don't control. Every 15°F (8°C) cooler roughly doubles how long a starter or dough takes. Measure where the jar sits, not the thermostat.",
    more: "ratios",
  },
  readyAt: {
    text: "When you'll use the starter. Crumb picks a feed that peaks about half an hour before, since a starter is at its strongest from just before its peak to a little after.",
    more: "peak",
  },
  jar: {
    text: "Optional. Weigh the jar's contents (minus the empty jar) and Crumb tells you how much to discard first. Discard isn't waste: it goes in pancakes, crackers and waffles.",
    more: "feeding",
  },
  ratio: {
    text: "Starter : flour : water by weight. 1:5:5 means 5 g each of flour and water for every gram of starter. More food per gram of starter means a slower rise, so a bigger ratio times a feed for later.",
    more: "ratios",
  },
  amounts: {
    text: "Keep this much starter, throw the rest out (or into a discard jar), then add the flour and water and mix.",
    more: "feeding",
  },
  remindPeak: {
    text: "Get a nudge when the model thinks it's at its peak. Check it and log the real time: that's how Crumb learns how fast your starter is.",
    more: "peak",
  },

  // ---------- peak ----------
  peak: {
    text: "Peak is the high point of the rise: about doubled, a domed top, bubbles all through. Soon after, the top flattens or starts to sink and the jar shows a ring where it was. That's when a starter is strongest.",
    more: "peak",
  },
  rise: {
    text: "How much it grew at its highest, as a percent. 100% means doubled. A healthy starter usually rises 75–200%. A rubber band at the starting level makes this easy to judge.",
    more: "peak",
  },
  speed: {
    text: "Every starter is different. Each peak you log is compared with what the model predicted, and later predictions are scaled to match. Three or four logged peaks is enough.",
    more: "peak",
  },

  // ---------- planning a bake ----------
  outOfOven: {
    text: "When you want bread, not when you start. Crumb works backward from here through every step, so pick a time you'll be home.",
  },
  pieces: {
    text: "How many loaves (or pizzas, or bagels) and how heavy each piece of dough is. The whole formula scales from these.",
    more: "percentages",
  },
  planStarter: {
    text: "Which starter to use. If it's in the fridge, the plan starts by taking it out and feeding it, because a cold starter is too sluggish to raise bread straight away.",
    more: "fridge",
  },
  levainSpeed: {
    text: "The levain is a separate small batch of fed starter made just for this dough. Quick (1:2:2) peaks in an afternoon; overnight (1:5:5) is mixed before bed and is ready in the morning.",
    more: "levain",
  },
  retard: {
    text: "A long rest in the fridge after shaping. It slows everything down, deepens the flavour, makes scoring easier, and lets you bake when it suits you. Change its length to move the other steps out of the night.",
    more: "retard",
  },
  night: {
    text: "Some steps land between 11pm and 6am. Slide the cold step longer or shorter, pick a different finish time, or use the overnight levain.",
    more: "retard",
  },
  formula: {
    text: "Weigh everything: cups vary by 20% or more. The % column is baker's percentage, each ingredient as a share of the total flour.",
    more: "percentages",
  },

  // ---------- recipes ----------
  hydration: {
    text: "All the water as a percent of all the flour, counting what's inside the levain. Under 65% is stiff (bagels, sandwich loaves); 70–78% is a typical open loaf; above 80% is slack and sticky (focaccia, ciabatta).",
    more: "hydration",
  },
  levainPct: {
    text: "Ripe levain as a percent of the total flour. Around 20% is typical for a loaf. More makes a faster, tangier dough; less gives you more time.",
    more: "levain",
  },
  salt: {
    text: "About 2% of the flour. Less tastes flat and ferments faster; much more slows the yeast. Add it after the autolyse if the recipe has one.",
    more: "percentages",
  },
  slowerWhenCool: {
    text: "Steps that depend on fermentation (bulk, proof) take longer in a cool kitchen. Crumb stretches them from the time you give at 76°F.",
    more: "bulk",
  },
  flexible: {
    text: "A step whose length can vary a lot without hurting the bread, like a cold retard. You choose its length within the range when you plan.",
    more: "retard",
  },
  folds: {
    text: "Sets of stretch and folds during bulk build strength without kneading. Crumb reminds you when each set is due.",
    more: "bulk",
  },
} satisfies Record<string, Tip>;

export type TipId = keyof typeof TIPS;

/** What to actually do for each kind of bake step, shown under "How do I do this?". */
export const STEP_HOWTO: Record<StepKind, string[]> = {
  starter: [
    "Take the jar out of the fridge and feed it right away at room temperature.",
    "Leave it on the counter until it has risen and domed. A cold starter can take a feed or two to wake up fully.",
  ],
  levain: [
    "In a clean jar, mix the amounts shown: a little ripe starter, flour and water.",
    "Cover loosely and leave it somewhere warm. It's ready when it has about doubled, the top is domed and it's full of bubbles.",
    "Too early and the dough rises slowly; a little past peak is fine.",
  ],
  autolyse: [
    "Mix just the flour and most of the water until no dry flour is left. Don't knead.",
    "Cover and rest. The flour soaks up the water and the dough starts building strength on its own, so it's smoother when you mix in the levain.",
  ],
  mix: [
    "Add the levain and salt (and any water held back) to the dough.",
    "Squeeze it through your fingers and fold it over itself until it comes back together and feels uniform, 3 to 5 minutes. Wet hands stop it sticking.",
  ],
  bulk: [
    "The dough's first rise, all in one container. Cover it and keep it warm (ideally 75–78°F).",
    "Do the sets of stretch and folds when Crumb reminds you, then leave it alone.",
    "It's done by look, not clock: risen about 50%, domed at the edges, bubbles on the sides and top, and it jiggles when you shake the container. A cool kitchen takes longer.",
  ],
  preshape: [
    "Tip the dough out onto an unfloured counter and divide it if you're making more than one.",
    "Gently round each piece into a loose ball with a bench scraper, then leave it uncovered. It relaxes so the final shape is easier.",
  ],
  shape: [
    "Lightly flour the top, flip it, and fold the sides in to make a tight package, then roll it up and drag it toward you to tighten the surface.",
    "Place it seam side up in a floured banneton (or a bowl lined with a floured towel) or into the pan.",
  ],
  proof: [
    "The final rise after shaping. Cover so it doesn't dry out.",
    "Poke test: flour a finger and press it in 1 cm. Springs straight back: needs longer. Comes back slowly and leaves a small dent: ready. Stays dented: bake now.",
  ],
  retard: [
    "Cover the shaped dough and put it in the fridge. It barely rises there, but it keeps developing flavour.",
    "Bake straight from the fridge: cold dough is easier to score and holds its shape.",
  ],
  temper: [
    "Take the dough out of the fridge, still covered, so it warms up and finishes rising.",
    "Start the oven now if it needs a long preheat.",
  ],
  preheat: [
    "Heat the oven with the Dutch oven, stone or steel inside. A full preheat makes the oven spring that opens up the crumb.",
    "Leave the dough in the fridge until it goes in.",
  ],
  boil: [
    "Bring a wide pot of water to a gentle boil with the malt syrup or honey (and a little baking soda) in it.",
    "Boil a few at a time, about a minute per side. That sets the chewy, shiny crust. Top them while they're wet.",
  ],
  bake: [
    "Turn the dough out onto parchment, score it with a razor or very sharp knife at a shallow angle, and load it quickly.",
    "Keep it covered (or steamed) for the first part so it can rise, then uncover to brown. It's done when deep brown and it sounds hollow underneath, or about 205°F inside.",
    "Let it cool for at least an hour before slicing: it's still cooking inside.",
  ],
  other: ["Follow the note on this step."],
};

export interface GuideEntry {
  id: GuideSection;
  title: string;
  paragraphs: string[];
}

/** The guide, in the order a new baker meets each idea. */
export const GUIDE: GuideEntry[] = [
  {
    id: "starter",
    title: "What a starter is",
    paragraphs: [
      "A sourdough starter is flour and water that wild yeast and bacteria live in. The yeast makes gas that raises bread; the bacteria make the acids that give sourdough its tang and keep it fresh longer.",
      "They eat flour. Each time you feed the starter, they wake up, multiply and fill the jar with bubbles, then run out of food and slow down. Looking after a starter is just feeding it on a rhythm that suits how often you bake.",
    ],
  },
  {
    id: "feeding",
    title: "How to feed",
    paragraphs: [
      "Feeding is mostly about getting rid of old starter so the new food goes further. Stir the starter, weigh out what you're keeping into a clean jar, and discard the rest (or keep it in a discard jar in the fridge for pancakes and crackers).",
      "Add the flour and water by weight, mix until there's no dry flour, and scrape down the sides. Put a rubber band or a strip of tape at the level so you can see the rise.",
      "Cover it loosely (a lid resting on top, not screwed down) and leave it. Then log the feed in Crumb, and later log when it peaked.",
    ],
  },
  {
    id: "ratios",
    title: "What the ratios do",
    paragraphs: [
      "A ratio like 1:5:5 is starter : flour : water by weight. It's the food-to-yeast balance: the more food per gram of starter, the longer the starter takes to eat through it and peak.",
      "So the ratio is a timer you set. 1:1:1 peaks in a few hours, which suits a bake later today. 1:5:5 takes most of a day or a night. 1:10:10 can go 15 hours or more, which suits feeding once a day.",
      "Temperature changes all of these. The table below uses your kitchen temperature, and Crumb adjusts for your starter once you've logged a few peaks.",
    ],
  },
  {
    id: "peak",
    title: "Recognising the peak",
    paragraphs: [
      "After a feed the starter rises, domes, and then falls back as the food runs out. Peak is the top of that curve, and it's when the starter is strongest.",
      "Signs: it has about doubled (or more), the top is domed and bubbly, and it smells pleasantly sour or yeasty. Past peak the top flattens or sinks, it leaves a smeared ring on the glass, and it smells sharper, like vinegar or nail polish.",
      "Use it for a levain anywhere from a little before peak to an hour or two after. Logging when it peaks is the most useful thing you can do in Crumb: it's how predictions get better.",
    ],
  },
  {
    id: "fridge",
    title: "Keeping it in the fridge",
    paragraphs: [
      "In the cold a starter barely ferments, so one feed lasts about a week. Feed it, let it rise for an hour or two at room temperature, then put it back in the fridge.",
      "Before a bake, take it out the day before and give it one or two feeds at room temperature. A starter straight from the fridge is sluggish and makes a slow, dense loaf. Crumb's bake plans add this step for you when your starter is in the fridge.",
      "Grey liquid on top (“hooch”) means it's hungry, not dead. Pour it off and feed it.",
    ],
  },
  {
    id: "hydration",
    title: "Hydration",
    paragraphs: [
      "Hydration is water as a percent of flour, by weight. A starter at 100% hydration has equal weights of each.",
      "For dough, it's the main thing that decides how it handles. Under 65% is stiff and easy to shape (bagels, sandwich bread). 70–78% is a typical crusty loaf. Above 80% is wet and sticky and makes the open, holey crumb of focaccia and ciabatta. Start lower while you learn to shape.",
      "Dough hydration counts the water inside the levain too, so it's the whole dough's water over the whole dough's flour.",
    ],
  },
  {
    id: "levain",
    title: "Levain",
    paragraphs: [
      "A levain is a separate batch of fed starter built just for one dough: a spoonful of your starter plus fresh flour and water, timed to peak when you mix. It means your main starter stays in its jar, untouched.",
      "The recipe says how much levain it needs (say 200 g). Crumb works out a build that makes that much, plus a little that sticks to the jar.",
      "Use a quick 1:2:2 build to mix the dough the same day, or an overnight 1:5:5 build mixed before bed.",
    ],
  },
  {
    id: "percentages",
    title: "Baker's percentages",
    paragraphs: [
      "Bread recipes are written as percentages of the flour, which always counts as 100%. A loaf at 75% hydration and 2% salt with 1000 g flour has 750 g water and 20 g salt.",
      "That's why recipes scale so easily: change the number of loaves or their weight and every ingredient follows. Crumb does the arithmetic, including subtracting the flour and water already inside the levain.",
      "Weigh everything with a kitchen scale. Measuring cups are too inconsistent for bread.",
    ],
  },
  {
    id: "bulk",
    title: "Bulk ferment and folds",
    paragraphs: [
      "Bulk fermentation is the dough's first and longest rise, in one container before shaping. It's where most of the flavour and structure develop.",
      "Stretch and folds build strength without kneading: with a wet hand, grab one side of the dough, stretch it up until it resists, and fold it over the top. Turn the container a quarter and repeat four times. That's one set.",
      "Judge the end by the dough, not the clock: about 50% bigger, domed edges, bubbles on the sides, and a jiggle when you shake it. Cooler kitchens take longer; Crumb stretches the time for you, but trust what you see.",
    ],
  },
  {
    id: "shaping",
    title: "Shaping",
    paragraphs: [
      "Shaping makes a tight skin on the outside of the dough so it holds its shape and rises up, not out. Use flour on top and a bare counter underneath: the dough needs a little grip to tighten.",
      "Pre-shape first: a loose round, left for 20–30 minutes to relax. Then the final shape: fold the sides into the middle, roll it up, and drag it toward you so the surface tightens.",
      "It takes practice. Lower-hydration doughs are much easier to learn on.",
    ],
  },
  {
    id: "retard",
    title: "The cold retard",
    paragraphs: [
      "After shaping, many loaves spend the night in the fridge. Fermentation slows almost to a stop, the flavour deepens, the cold dough is far easier to score, and you get to bake in the morning instead of at midnight.",
      "Its length is flexible: anywhere in the recipe's range works. That's why Crumb lets you slide it, to move the hands-on steps to times you're awake.",
    ],
  },
  {
    id: "baking",
    title: "Baking",
    paragraphs: [
      "A very hot oven and steam early on let the loaf rise fully before the crust sets. A preheated Dutch oven with its lid on traps the dough's own steam; remove the lid after about 20 minutes to brown.",
      "Score just before baking: one confident slash at a shallow angle, about 1 cm deep, gives the loaf a controlled place to open.",
      "Cool for an hour or more before slicing. Cut early and the crumb is gummy.",
    ],
  },
  {
    id: "troubleshooting",
    title: "When things go wrong",
    paragraphs: [
      "Not rising: it's probably cold or under-fed. Move it somewhere warmer (an oven with just the light on) and feed it at a lower ratio like 1:1:1 a couple of times in a row.",
      "Grey liquid on top: hooch. It's hungry. Pour it off, feed it.",
      "Smells like nail polish or vinegar: past its peak and hungry. Feed it, and maybe more often or at a bigger ratio.",
      "Pink, orange or fuzzy mould: throw it away and start again, or rescue a spoonful from the bottom only if you're confident. Clear liquid and a sour smell are normal; colour and fuzz are not.",
      "Flat, dense bread: usually under-fermented. Let bulk run longer, until the dough shows the signs, and use the starter at its peak.",
    ],
  },
];
