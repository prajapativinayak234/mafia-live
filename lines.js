'use strict';
const THROWS = ['🍅', '🥿', '🧅', '🤡', '💩', '🪳', '🌶️', '👀'];
const ROASTS = [
  '{n}, you lie worse than a menu with no prices 🍽️',
  '{n} is so sus even the paneer is suspicious 🧀',
  '{n}, your poker face belongs to a Bollywood villain 😈',
  'Trusting {n} is like trusting a Mumbai local\'s AC 🚆',
  '{n} votes like they are guessing a Wi-Fi password 📶',
  '{n}, did your alibi come from a WhatsApp forward? 📱',
  '{n} acts innocent like a cat next to spilled milk 🐈',
  '{n}, even the Mafia would not recruit you 💀',
  '{n} has the energy of a group admin who never replies 🫠'
];

// Fallback narration used when no AI key is configured (or the AI call fails).
// Placeholders: {a} = main player name, {r} = their role, {w} = winner label.
const CANNED = {
  bollywood: {
    start: ['Doston, the stage is set, the villains are hiding in plain sight. Let the drama begin!', 'Lights, camera, suspicion! Tonight, friendships will break and alibis will fall.'],
    night: ['The moon hides behind a cloud. Somewhere, a villain sharpens his dialogue.', 'Silence in the town... too much silence. Interval is still far away.'],
    dawn_died: ['Tragedy! {a} has left us, and the background music is already crying. They were the {r}.', '{a} fell like the hero in the last reel. The {r} will be missed!'],
    dawn_safe: ['Plot twist! The doctor arrives just in time, like the climax of a blockbuster!', 'The Mafia strikes, but fate says "picture abhi baaki hai"! Nobody died.'],
    dawn_quiet: ['A quiet night. Too quiet. Even the villain forgot his lines.'],
    verdict_out: ['The town has spoken! {a} is out, and what a dramatic exit. The {r}, everyone!', 'Court is closed. {a} walks away in slow motion. They were the {r}.'],
    verdict_tie: ['A tie! Even the censor board could not decide. Nobody leaves.'],
    over_town: ['The town wins! The villains are exposed, the audience claps, roll credits!'],
    over_mafia: ['The Mafia wins! The villain laughs, the hero weeps, and the town learns a lesson.'],
    over_jester: ['The Jester wins! The fool got himself voted out and the whole town clapped for the wrong reason. Interval!']
  },
  uncle: {
    start: ['Arrey beta, listen carefully. One of you is lying, and your uncle already knows who. Let us begin.', 'In my time, we played this game with honesty. Anyway, start, start.'],
    night: ['Night has come, everyone sleep. This is why I say sleep early, but nobody listens.', 'Quiet now. Even the neighbours are asleep, and they never sleep.'],
    dawn_died: ['Hai hai! {a} is gone. And they were the {r}! Sharma ji ka beta would have survived.', 'Terrible news. {a}, the {r}, has left us. See, this is what happens.'],
    dawn_safe: ['Nobody died! The doctor saved the day. Such a responsible person, unlike you lot.', 'The Mafia failed. Good. Hard work always wins, I always say.'],
    dawn_quiet: ['A peaceful night. Maybe the Mafia also needed rest. Very sensible.'],
    verdict_out: ['So you voted {a} out. They were the {r}. I hope you all feel responsible!', '{a} is gone, the {r}. Democracy is a wonderful thing, but also very noisy.'],
    verdict_tie: ['A tie! Nobody can make a decision. Typical. Nobody is out.'],
    over_town: ['The town won! Finally, some good judgement. I am proud of everyone, even you.'],
    over_mafia: ['The Mafia won! Beta, this is why I told you not to trust anyone. Next time, listen.'],
    over_jester: ['The Jester wins! Beta, you voted out the clown and gave him exactly what he wanted. Sharma ji\'s son would not do this.']
  },
  roast: {
    start: ['Welcome, amateurs. Tonight we find out who lies best and who just sweats loudest.', 'Alright, everyone here is suspicious. Some of you just look it. Let us play.'],
    night: ['Night falls. Go to sleep, you suspicious bunch.', 'Eyes closed. Imagination open. Poor decisions loading.'],
    dawn_died: ['{a} is dead. The {r}. Honestly, the Mafia did them a favour with those arguments.', 'Bad news for {a}, the {r}. Good news for everyone who got tired of listening to them.'],
    dawn_safe: ['The Doctor saved someone. Finally, a competent person in this group.', 'Nobody died. The Mafia missed. Even your villains lack commitment.'],
    dawn_quiet: ['Nobody died. The Mafia clearly had a team-building event instead.'],
    verdict_out: ['{a} was voted out. The {r}. You voted with confidence. Not accuracy. Confidence.', 'Bye {a}, the {r}. That was a very democratic way to be wrong or right. We will see.'],
    verdict_tie: ['A tie. A whole group of people, zero decisiveness. Impressive.'],
    over_town: ['Town wins! You finally found the liars. Do not let it go to your head, it is a small head.'],
    over_mafia: ['Mafia wins! You were out-lied by your own friends. Reflect on that.'],
    over_jester: ['The Jester wins! You all took the bait. You got played by the one person begging to be voted out.']
  },
  noir: {
    start: ['The city sleeps uneasily. Among you walk wolves in human skin. The game begins.', 'Rain on the window, doubt in the air. One of you is not who they say they are.'],
    night: ['Darkness settles over the town. Somewhere, a decision is whispered.', 'The clock strikes midnight. Shadows begin to move.'],
    dawn_died: ['Dawn reveals the truth: {a} did not survive the night. The {r}, gone forever.', 'A cold morning. {a}, the {r}, lies silent. The town will remember.'],
    dawn_safe: ['The knife was raised, but a steady hand intervened. No blood this night.', 'Dawn breaks and everyone breathes. Someone was spared by a whisper of luck.'],
    dawn_quiet: ['The night passed without a sound. Which is the most suspicious sound of all.'],
    verdict_out: ['The town has chosen. {a} is cast out. They were the {r}. The truth is a heavy thing.', 'With a heavy heart, the town banishes {a}, the {r}.'],
    verdict_tie: ['The vote splits like a broken mirror. Nobody is cast out.'],
    over_town: ['The darkness is lifted. The town stands, battered but whole.'],
    over_mafia: ['The last light goes out. The Mafia owns the town now.'],
    over_jester: ['The Jester wins. The fool smiled as the town voted him out, and for once the laugh was his.']
  }
};

module.exports = { THROWS, ROASTS, CANNED };
