/* ============================================================
   levels.js — campaign content
   ------------------------------------------------------------
   Three acts, one per training day. Four seals per act.

   Each hint carries a piece of the seal-keeper's backstory, so
   asking for help returns MORE story, never less. In a room where
   people are wary of looking slow, that inversion is the point.
   ============================================================ */
(function (global) {
  'use strict';

  // ---- shared art -----------------------------------------------------
  var ACTS = [
    {
      n: 1,
      name: 'The Drowned Coast',
      day: 'Day One',
      teaches: 'strings · conditionals · loops · lists',
      hue: '#5ad1c8',
      hue2: '#1f6f6b',
      intro: [
        { who: 'NARRATOR', text: 'The Iron Compiler held the realm together for a thousand years. Then it broke — not all at once, but the way a long argument breaks: quietly, in the middle, while everyone was busy.' },
        { who: 'NARRATOR', text: 'Its fragments fell across the provinces and hardened into Seal-keepers. Each one remembers a single piece of what the Compiler used to do, and each one has been doing that piece, alone, ever since.' },
        { who: 'VEX', text: 'You are the last Architect. That is less impressive than it sounds — it mostly means everyone else left.' },
        { who: 'VEX', text: 'The keepers are not your enemies, Architect. They are stuck. Break a seal and you do not kill the thing behind it. You let it stop.' },
        { who: 'VEX', text: 'We start at the coast, where the water took the low country. Try not to look nervous. They can tell.' }
      ]
    },
    {
      n: 2,
      name: 'The Iron Heartland',
      day: 'Day Two',
      teaches: 'pandas · DataFrames · filtering · merge',
      hue: '#f6b357',
      hue2: '#a1421c',
      intro: [
        { who: 'NARRATOR', text: 'Inland, the ground stops drowning and starts burning. The Heartland fed the old realm — every granary, every census, every ledger of who owed what to whom.' },
        { who: 'VEX', text: 'The coast keepers only knew how to count. These ones knew how to *organise*. That is a harder thing to be trapped inside.' },
        { who: 'VEX', text: 'They will not accept a list where a lookup belongs. Fair warning.' }
      ]
    },
    {
      n: 3,
      name: 'The Obsidian Throne',
      day: 'Day Three',
      teaches: 'nested data · classes · exceptions · capstone',
      hue: '#b79cf7',
      hue2: '#5b3aa8',
      intro: [
        { who: 'NARRATOR', text: 'The road climbs. The provinces behind you have started to move again — smoke from chimneys, carts on the road, the ordinary noise of a place that is allowed to change.' },
        { who: 'VEX', text: 'Ahead is the Throne. Orrin sits there. He was Architect before you, and he did not fail.' },
        { who: 'VEX', text: 'That is what frightens me. He looked at every future the realm could have, and then he stopped the realm on purpose. I would very much like you to find the future he missed.' }
      ]
    }
  ];

  // ---- sigils (viewBox 0 0 100 100, inherit currentColor) -------------
  var S = {
    gate: '<path d="M22 84V46a28 28 0 0 1 56 0v38" /><path d="M50 84V58" /><circle cx="50" cy="50" r="5"/><path d="M12 92c8 0 8-6 16-6s8 6 16 6 8-6 16-6 8 6 16 6"/>',
    wall: '<rect x="18" y="34" width="64" height="46" rx="3"/><path d="M18 50h64M18 65h64M34 34v16M50 50v15M66 34v16M34 65v15M66 65v15"/><path d="M18 34l8-12h48l8 12"/>',
    tower: '<path d="M38 86V40h24v46z"/><path d="M34 40h32l-6-14H40z"/><circle cx="50" cy="20" r="5"/><path d="M22 24l10 6M78 24L68 30M18 44h8M82 44h-8"/>',
    field: '<path d="M50 14v72"/><path d="M26 38h48"/><circle cx="26" cy="52" r="12"/><circle cx="74" cy="52" r="12"/><path d="M38 86h24"/>',
    ledger: '<rect x="24" y="18" width="52" height="66" rx="4"/><path d="M34 34h32M34 46h32M34 58h20"/><circle cx="62" cy="66" r="4"/><circle cx="72" cy="66" r="4"/>',
    granary: '<path d="M24 84V44l26-22 26 22v40z"/><path d="M40 84V62h20v22"/><path d="M50 34v-1"/><path d="M16 84h68"/>',
    council: '<circle cx="50" cy="52" r="26"/><circle cx="50" cy="52" r="8"/><circle cx="50" cy="18" r="5"/><circle cx="80" cy="36" r="5"/><circle cx="80" cy="70" r="5"/><circle cx="50" cy="88" r="5"/><circle cx="20" cy="70" r="5"/><circle cx="20" cy="36" r="5"/>',
    rings: '<circle cx="38" cy="50" r="22"/><circle cx="62" cy="50" r="22"/><path d="M50 30v40"/>',
    eye: '<path d="M12 50s16-22 38-22 38 22 38 22-16 22-38 22S12 50 12 50z"/><circle cx="50" cy="50" r="10"/><path d="M50 14v-6M50 92v-6M14 26l-5-4M86 26l5-4M14 74l-5 4M86 74l5 4"/>',
    anvil: '<path d="M22 46h56l-8 14H30z"/><path d="M40 60h20v14H40z"/><path d="M28 74h44v8H28z"/><path d="M30 34l8 8M50 28v10M70 34l-8 8"/>',
    scroll: '<path d="M28 22h44v56H28z"/><path d="M28 22a6 6 0 0 0 0 12h44"/><path d="M28 78a6 6 0 0 0 0-12h44"/><path d="M40 44h20M40 56h14"/><path d="M74 30l14 40" stroke-dasharray="6 5"/>',
    throne: '<path d="M30 84V44l10-8v-8h20v8l10 8v40z"/><path d="M50 14l8 14h-16z"/><path d="M22 84h56"/><path d="M40 60h20"/><path d="M50 36v24"/>'
  };

  function sigil(inner) {
    return '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" ' +
           'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
           inner + '</svg>';
  }

  // =====================================================================
  //  LEVELS
  // =====================================================================
  var LEVELS = [

    /* ============ ACT I — THE DROWNED COAST ============ */
    {
      id: 'a1', act: 1,
      place: 'The Drowned Gate',
      province: 'Saltmarch',
      teaches: 'f-strings & return',
      sigil: sigil(S.gate),
      keeper: {
        name: 'The Tollkeeper',
        taunt: 'State your muster properly, or stand in the water until you can.'
      },
      story: [
        { who: 'NARRATOR', text: 'The gate at Saltmarch stands in four feet of seawater. It has not been closed in two centuries, because there is no longer a wall on either side of it.' },
        { who: 'KEEPER', text: 'HALT. Name and count. Name and count. Name and count.' },
        { who: 'VEX', text: 'It greets people. That is all it was ever for. It has been greeting an empty road since before your grandmother was born.' },
        { who: 'VEX', text: 'Give it one properly formed line and it can finally stop asking.' }
      ],
      fn: 'muster',
      brief:
        '<p>The Tollkeeper needs each arriving company announced in exactly one format.</p>' +
        '<p>Return the string <code>"Kestrel brings 12 spears."</code> for <code>name="Kestrel"</code> and <code>count=12</code>.</p>' +
        '<ul><li>Return the string — do not <code>print</code> it.</li>' +
        '<li>Mind the full stop at the end.</li></ul>',
      starter: 'def muster(name, count):\n    # Build the line the Tollkeeper is waiting for.\n    \n',
      tests: [
        { label: 'A named company', args: ['Kestrel', 12], expect: 'Kestrel brings 12 spears.' },
        { label: 'An empty company', args: ['Ilva', 0], expect: 'Ilva brings 0 spears.' },
        { label: 'A long name', args: ['House Ferrowmoor', 340], expect: 'House Ferrowmoor brings 340 spears.' }
      ],
      bonus: 'One spear is still <em>one spear</em>, not "1 spears". Make the word singular when <code>count == 1</code>.',
      hints: [
        {
          lore: 'I was the piece that said hello. Small work. I was good at it.',
          text: 'An f-string puts a value inside a string. Write <code>f</code> before the opening quote, then anything in <code>{braces}</code> gets evaluated: <code>f"hello {name}"</code>.'
        },
        {
          lore: 'Nobody has come down this road in a long time. I kept the greeting ready anyway.',
          text: 'You want <code>f"{name} brings {count} spears."</code> — and it has to leave your function with <code>return</code>, not <code>print</code>. <code>print</code> shows a value; <code>return</code> hands it back.'
        },
        {
          lore: 'Say it right and I can put the gate down. It has been open so long the hinges have coral on them.',
          text: 'The whole thing is two lines:<br><code>def muster(name, count):</code><br><code>&nbsp;&nbsp;&nbsp;&nbsp;return f"{name} brings {count} spears."</code>'
        }
      ],
      solution: 'def muster(name, count):\n    return f"{name} brings {count} spears."\n',
      victory: [
        { who: 'KEEPER', text: 'Kestrel brings twelve spears. ...Kestrel brings twelve spears. Yes. That is the shape of it. That is the shape it was always meant to be.' },
        { who: 'NARRATOR', text: 'The gate lowers itself into the water with great dignity, and stays there.' },
        { who: 'VEX', text: 'One down. It is going to get harder, and you are going to get faster. That is the whole arrangement.' }
      ]
    },

    {
      id: 'a2', act: 1,
      place: 'The Tidewall',
      province: 'Saltmarch',
      teaches: 'loops, conditionals, modulo',
      sigil: sigil(S.wall),
      keeper: {
        name: 'The Counter',
        taunt: 'One. Two. Three — no. Wrong. Start again. One. Two. Three —'
      },
      story: [
        { who: 'NARRATOR', text: 'The Tidewall is scratched from end to end with tally marks. Thousands of them. Every few hundred marks, the counting restarts.' },
        { who: 'KEEPER', text: 'Every third stone belongs to the Iron. Every fifth belongs to the Tide. Where they meet, the stone belongs to SALTMARCH. I know this. I KNOW this. I cannot hold it and count at the same time.' },
        { who: 'VEX', text: 'It can count, or it can remember the rule. Not both. Do the counting for it.' }
      ],
      fn: 'toll',
      brief:
        '<p>Walk the stones from <code>1</code> to <code>n</code> and return a <strong>list of strings</strong>, one per stone:</p>' +
        '<ul>' +
        '<li>divisible by <strong>3 and 5</strong> → <code>"SALTMARCH"</code></li>' +
        '<li>divisible by <strong>3</strong> → <code>"IRON"</code></li>' +
        '<li>divisible by <strong>5</strong> → <code>"TIDE"</code></li>' +
        '<li>otherwise → the number as a string, e.g. <code>"7"</code></li>' +
        '</ul>' +
        '<p>Order matters. Check the double rule first.</p>',
      starter: 'def toll(n):\n    stones = []\n    # for each stone from 1 to n...\n    \n    return stones\n',
      tests: [
        { label: 'First five stones', args: [5], expect: ['1', '2', 'IRON', '4', 'TIDE'] },
        { label: 'Reaches the meeting stone', args: [15], expect: ['1', '2', 'IRON', '4', 'TIDE', 'IRON', '7', '8', 'IRON', 'TIDE', '11', 'IRON', '13', '14', 'SALTMARCH'] },
        { label: 'No wall at all', args: [0], expect: [] },
        { label: 'A single stone', args: [1], expect: ['1'] }
      ],
      bonus: 'Rewrite the whole thing as a single list comprehension. It is legal, it is readable if you are careful, and it is a good argument to have with the person next to you.',
      hints: [
        {
          lore: 'I counted the stones as they were laid. I was there for every one.',
          text: '<code>range(1, n + 1)</code> gives you 1 up to n inclusive. The <code>+ 1</code> is the part everyone forgets.'
        },
        {
          lore: 'Then the water came and took the wall, and I kept counting, because that was the piece of me that survived.',
          text: '<code>i % 3 == 0</code> asks "is i divisible by 3". Test the <strong>both</strong> case first — <code>i % 15 == 0</code>, or <code>i % 3 == 0 and i % 5 == 0</code> — because otherwise the plain <code>IRON</code> branch grabs it before you get there.'
        },
        {
          lore: 'If you finish the count, the number stops mattering. That would be a kindness.',
          text: 'Build a list with <code>stones.append(...)</code> inside the loop, then <code>return stones</code>. The number branch needs <code>str(i)</code> — the test wants the string <code>"7"</code>, not the integer <code>7</code>.'
        }
      ],
      solution:
        'def toll(n):\n' +
        '    stones = []\n' +
        '    for i in range(1, n + 1):\n' +
        '        if i % 3 == 0 and i % 5 == 0:\n' +
        '            stones.append("SALTMARCH")\n' +
        '        elif i % 3 == 0:\n' +
        '            stones.append("IRON")\n' +
        '        elif i % 5 == 0:\n' +
        '            stones.append("TIDE")\n' +
        '        else:\n' +
        '            stones.append(str(i))\n' +
        '    return stones\n',
      victory: [
        { who: 'KEEPER', text: '...fourteen. SALTMARCH. And then nothing. There is nothing after fifteen. The wall ends. The wall ends!' },
        { who: 'VEX', text: 'It is delighted. I have never seen a fragment be delighted before.' }
      ]
    },

    {
      id: 'a3', act: 1,
      place: 'The Signal Towers',
      province: 'Saltmarch',
      teaches: 'string indexing & building',
      sigil: sigil(S.tower),
      keeper: {
        name: 'The Herald',
        taunt: 'Too long. TOO LONG. The fire dies before the sentence ends.'
      },
      story: [
        { who: 'NARRATOR', text: 'Six towers along the headland, each with a cold brazier. They were built to pass a message down the coast in under a minute.' },
        { who: 'KEEPER', text: 'I cannot send words. I can send letters. One letter, one fire. Give me the short form or give me nothing.' },
        { who: 'VEX', text: 'It wants initials. Take each word, take its first letter, put them together, shout them in capitals. Heralds have always been like this.' }
      ],
      fn: 'banner',
      brief:
        '<p>Given a list of words, return the signal code: the <strong>first letter of each word</strong>, uppercased, joined into one string.</p>' +
        '<p><code>["iron", "tide", "marsh"]</code> → <code>"ITM"</code></p>' +
        '<p>An empty list signals nothing at all: <code>""</code>.</p>',
      starter: 'def banner(words):\n    code = ""\n    \n    return code\n',
      tests: [
        { label: 'Three towers lit', args: [['iron', 'tide', 'marsh']], expect: 'ITM' },
        { label: 'Already shouting', args: [['Saltmarch']], expect: 'S' },
        { label: 'Silence', args: [[]], expect: '' },
        { label: 'Mixed case', args: [['iron', 'Tide', 'mArSh', 'gate']], expect: 'ITMG' }
      ],
      bonus: 'The Herald cannot be bothered with small words. Skip any word shorter than three letters.',
      hints: [
        {
          lore: 'I lit the first fire when the fleet came. Everyone remembers the fleet. Nobody remembers who told them it was coming.',
          text: '<code>word[0]</code> gives you the first character of a string. Strings index exactly like lists do.'
        },
        {
          lore: 'Six towers. I was the light in all six at once. It is a strange thing to be in six places and still be alone.',
          text: '<code>.upper()</code> makes a character uppercase. You can build the answer up with <code>code = code + letter</code>, or with <code>code += letter</code>.'
        },
        {
          lore: 'Send it once, correctly, and the fires can go out.',
          text: 'Loop with <code>for word in words:</code> then <code>code += word[0].upper()</code>. Start with <code>code = ""</code> before the loop so there is something to add to.'
        }
      ],
      solution:
        'def banner(words):\n' +
        '    code = ""\n' +
        '    for word in words:\n' +
        '        code += word[0].upper()\n' +
        '    return code\n',
      victory: [
        { who: 'NARRATOR', text: 'Six fires catch in sequence down the headland, spelling three letters at the empty sea. Then, one by one, they go out.' },
        { who: 'KEEPER', text: 'Message sent. Message *sent*.' }
      ]
    },

    {
      id: 'a4', act: 1,
      place: 'The Reckoning Field',
      province: 'Saltmarch',
      teaches: 'accumulating with conditions',
      sigil: sigil(S.field),
      keeper: {
        name: 'The Reckoner',
        taunt: 'The number is wrong. The number has been wrong for two hundred years.'
      },
      story: [
        { who: 'NARRATOR', text: 'A flat field where the muster rolls were read. The Reckoner stands in the middle of it holding a total that has never balanced.' },
        { who: 'KEEPER', text: 'They wrote deserters into the roll as negative numbers. To be honest about the loss. It was meant to be honest.' },
        { who: 'KEEPER', text: 'But I must report the strength of the army. Not the shame of it. And I cannot tell the two apart any more.' },
        { who: 'VEX', text: 'Count only what is still standing. The negatives are gone; they are not owed a place in the total.' }
      ],
      fn: 'tally',
      brief:
        '<p>Given a list of numbers, return the sum of the <strong>positive</strong> ones only. Negatives are deserters — skip them.</p>' +
        '<p><code>[10, -3, 5]</code> → <code>15</code></p>' +
        '<p>An empty field totals <code>0</code>.</p>',
      starter: 'def tally(counts):\n    total = 0\n    \n    return total\n',
      tests: [
        { label: 'Some desertion', args: [[10, -3, 5]], expect: 15 },
        { label: 'Nobody left', args: [[-1, -2, -8]], expect: 0 },
        { label: 'Empty roll', args: [[]], expect: 0 },
        { label: 'A full muster', args: [[120, 80, 44]], expect: 244 },
        { label: 'Zero is not a deserter', args: [[0, 5]], expect: 5 }
      ],
      bonus: 'Report the shame too: return a <strong>tuple</strong> of <code>(total, number_of_deserters)</code>. You will need to change the tests to check it — do it in your head, or argue about it with a neighbour.',
      hints: [
        {
          lore: 'I read the rolls aloud before every march. I knew the names.',
          text: 'Start a running total at <code>0</code> before the loop, then add to it inside the loop.'
        },
        {
          lore: 'Eight hundred and forty names, the last time. I still have them. Nobody has ever asked me for them.',
          text: 'Inside the loop, guard the addition: <code>if n > 0:</code> then <code>total += n</code>.'
        },
        {
          lore: 'Give me a number I can say out loud without flinching.',
          text: '<code>for n in counts:</code> / <code>&nbsp;&nbsp;&nbsp;&nbsp;if n > 0:</code> / <code>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;total += n</code> — then return <code>total</code> after the loop, not inside it.'
        }
      ],
      solution:
        'def tally(counts):\n' +
        '    total = 0\n' +
        '    for n in counts:\n' +
        '        if n > 0:\n' +
        '            total += n\n' +
        '    return total\n',
      victory: [
        { who: 'KEEPER', text: 'Two hundred and forty-four standing. That is the number. That is a number I can carry.' },
        { who: 'VEX', text: 'The coast is yours, Architect. Look behind you — there is smoke coming off the Saltmarch chimneys. People are cooking dinner. They have not done that in a while.' },
        { who: 'NARRATOR', text: 'End of Act One.' }
      ]
    },

    /* ============ ACT II — THE IRON HEARTLAND ============ */
    {
      id: 'b1', act: 2,
      needs: ['pandas'],
      place: 'The Census Hall',
      province: 'Emberfold',
      teaches: 'DataFrames · selecting rows & columns',
      sigil: sigil(S.ledger),
      keeper: {
        name: 'The Census-Taker',
        taunt: 'I have every name on its own sheet of paper. Ask me a question about two of them and I must read the floor.'
      },
      story: [
        { who: 'NARRATOR', text: 'The Census Hall is knee-deep in loose paper. Every sheet carries one household: a name, a province, a count of grain, a count of spears.' },
        { who: 'KEEPER', text: 'I can hold one sheet. I cannot hold the table. Give me the table and I will let you pass.' },
        { who: 'VEX', text: 'The coast taught you lists. Lists end here. This one wants rows and columns — a thing you can slice without walking it.' },
        { who: 'VEX', text: 'Two ways in. Square brackets take a column by name. <code>.loc</code> takes rows by a condition. Learn both today; you will use nothing else for the rest of the act.' }
      ],
      fn: 'muster_roll',
      brief:
        '<p>The Hall keeps its records as a list of dicts. Build a <strong>DataFrame</strong> from it, ' +
        'then hand back only the households worth mustering.</p>' +
        '<p>Write <code>muster_roll(records)</code> so it:</p>' +
        '<ul>' +
        '<li>builds a DataFrame from <code>records</code>,</li>' +
        '<li>keeps only rows where <code>spears</code> is <strong>greater than 50</strong>,</li>' +
        '<li>returns only the <code>house</code> and <code>spears</code> columns, <em>in that order</em>.</li>' +
        '</ul>' +
        '<p>Row order stays as it came in. The index is ignored when your answer is checked, so no need to reset it.</p>',
      bonus: 'return the surviving rows sorted by <code>spears</code>, largest first.',
      starter:
        'import pandas as pd\n\n' +
        'def muster_roll(records):\n' +
        '    df = pd.DataFrame(records)\n' +
        '    # keep the rows you want, then the columns you want\n' +
        '    \n',
      tests: [
        {
          label: 'three houses, one too small',
          expr: 'muster_roll([{"house": "Ferrow", "spears": 120}, {"house": "Vale", "spears": 20}, {"house": "Kestrel", "spears": 300}])',
          show: 'muster_roll([Ferrow 120, Vale 20, Kestrel 300])',
          expect_expr: 'pd.DataFrame({"house": ["Ferrow", "Kestrel"], "spears": [120, 300]})'
        },
        {
          label: 'extra columns are dropped',
          expr: 'muster_roll([{"house": "Ash", "spears": 90, "grain": 4}, {"house": "Bell", "spears": 51, "grain": 9}])',
          show: 'muster_roll([Ash 90/grain 4, Bell 51/grain 9])',
          expect_expr: 'pd.DataFrame({"house": ["Ash", "Bell"], "spears": [90, 51]})'
        },
        {
          label: 'exactly 50 does not qualify',
          expr: 'muster_roll([{"house": "Marrow", "spears": 50}, {"house": "Rook", "spears": 51}])',
          show: 'muster_roll([Marrow 50, Rook 51])',
          expect_expr: 'pd.DataFrame({"house": ["Rook"], "spears": [51]})'
        },
        {
          label: 'nobody qualifies',
          expr: 'list(muster_roll([{"house": "Ilva", "spears": 3}]).columns)',
          show: 'columns survive an empty result',
          expect: ['house', 'spears']
        }
      ],
      hints: [
        {
          lore: 'I counted this province for six hundred years. I was good at it. I was only ever asked for one number at a time.',
          text: '<code>pd.DataFrame(records)</code> turns a list of dicts into a table — the dict keys become the columns. Print it with <code>print(df)</code> inside your function to see what you are holding.'
        },
        {
          lore: 'Once, a Steward asked me for every house above a threshold. I read for nine days. She did not wait.',
          text: 'A comparison on a column gives you a column of True/False: <code>df["spears"] &gt; 50</code>. Feed that back into the frame to keep only the True rows: <code>df[df["spears"] &gt; 50]</code>.'
        },
        {
          lore: 'Give me the shape of the question and I will never have to read the floor again.',
          text: 'Selecting several columns takes a <em>list</em> inside the brackets — note the double brackets: <code>df[["house", "spears"]]</code>. Chain it after the row filter.'
        }
      ],
      solution:
        'import pandas as pd\n\n' +
        'def muster_roll(records):\n' +
        '    df = pd.DataFrame(records)\n' +
        '    df = df[df["spears"] > 50]\n' +
        '    return df[["house", "spears"]]\n',
      victory: [
        { who: 'NARRATOR', text: 'The paper lifts off the floor and settles into a grid, ruled and quiet. The Census-Taker reads the whole thing at a glance for the first time in six centuries.' },
        { who: 'KEEPER', text: 'Oh. It was always a table. I was holding it one sheet at a time.' }
      ]
    },

    {
      id: 'b2', act: 2,
      needs: ['pandas'],
      place: 'The Granary Ledger',
      province: 'Emberfold',
      teaches: 'new columns · renaming · null rows',
      sigil: sigil(S.granary),
      keeper: {
        name: 'The Steward',
        taunt: 'Some sheets came back from the fire with holes in them. I cannot add a hole. So I add nothing.'
      },
      story: [
        { who: 'NARRATOR', text: 'The granary survived the burning. Its ledger did not, entirely. Some rows came back scorched — a house name, a blank where the grain count should be.' },
        { who: 'KEEPER', text: 'I will not guess. A guessed number in a ledger is worse than a fire.' },
        { who: 'VEX', text: 'It is right, for once. Do not invent the missing rows — drop them, and say so. Then give it the column it actually needs.' }
      ],
      fn: 'settle_ledger',
      brief:
        '<p>Take the scorched ledger and make it usable.</p>' +
        '<p><code>settle_ledger(df)</code> receives a DataFrame with columns ' +
        '<code>house</code>, <code>grain</code>, <code>mouths</code>. Return a new frame that:</p>' +
        '<ul>' +
        '<li><strong>drops</strong> any row where <code>grain</code> is missing (<code>NaN</code>),</li>' +
        '<li>adds a column <code>ration</code> = <code>grain</code> ÷ <code>mouths</code>, rounded to 1 decimal,</li>' +
        '<li>renames <code>house</code> to <code>holding</code>.</li>' +
        '</ul>' +
        '<p>Final column order: <code>holding</code>, <code>grain</code>, <code>mouths</code>, <code>ration</code>. ' +
        'Do not modify the frame you were handed — the Steward keeps the original.</p>',
      bonus: 'add a boolean <code>short</code> column flagging any holding whose ration is under <code>2.0</code>.',
      starter:
        'import pandas as pd\n\n' +
        'def settle_ledger(df):\n' +
        '    out = df.copy()\n' +
        '    # drop the scorched rows, add ration, rename house\n' +
        '    \n',
      tests: [
        {
          label: 'one scorched row is dropped',
          expr: 'settle_ledger(pd.DataFrame({"house": ["Ferrow", "Vale", "Ash"], "grain": [100.0, None, 90.0], "mouths": [8, 4, 4]}))',
          show: 'settle_ledger(ledger with Vale scorched)',
          expect_expr: 'pd.DataFrame({"holding": ["Ferrow", "Ash"], "grain": [100.0, 90.0], "mouths": [8, 4], "ration": [12.5, 22.5]})'
        },
        {
          label: 'rounding to one decimal',
          expr: 'settle_ledger(pd.DataFrame({"house": ["Rook"], "grain": [100.0], "mouths": [3]}))',
          show: 'settle_ledger(Rook: 100 grain, 3 mouths)',
          expect_expr: 'pd.DataFrame({"holding": ["Rook"], "grain": [100.0], "mouths": [3], "ration": [33.3]})'
        },
        {
          label: 'nothing scorched, nothing dropped',
          expr: 'len(settle_ledger(pd.DataFrame({"house": ["A", "B"], "grain": [10.0, 20.0], "mouths": [2, 5]})))',
          show: 'row count when the ledger is clean',
          expect: 2
        },
        {
          label: 'the original frame is untouched',
          expr: '(lambda d: (settle_ledger(d), list(d.columns))[1])(pd.DataFrame({"house": ["A"], "grain": [10.0], "mouths": [2]}))',
          show: 'caller\'s frame still has its own columns',
          expect: ['house', 'grain', 'mouths']
        }
      ],
      hints: [
        {
          lore: 'I was built to be trusted. That is the whole of me. A Steward who guesses is just a thief who is slower about it.',
          text: 'Missing values are <code>NaN</code>. <code>df.dropna(subset=["grain"])</code> removes rows where that one column is empty — other columns are left alone.'
        },
        {
          lore: 'The fire came through in an afternoon. I have been staring at the holes since.',
          text: 'A new column is just an assignment: <code>out["ration"] = out["grain"] / out["mouths"]</code>. Whole columns divide elementwise — no loop. Wrap it in <code>.round(1)</code>.'
        },
        {
          lore: 'Call it a holding, not a house. A house is where people sleep. A holding is what it owes.',
          text: '<code>out = out.rename(columns={"house": "holding"})</code>. Renaming returns a <em>new</em> frame, so you must assign it back.'
        }
      ],
      solution:
        'import pandas as pd\n\n' +
        'def settle_ledger(df):\n' +
        '    out = df.copy()\n' +
        '    out = out.dropna(subset=["grain"])\n' +
        '    out["ration"] = (out["grain"] / out["mouths"]).round(1)\n' +
        '    out = out.rename(columns={"house": "holding"})\n' +
        '    return out\n',
      victory: [
        { who: 'NARRATOR', text: 'The Steward reads the new column, then reads it again. Ration. How much each mouth actually gets. Nobody had ever asked it to divide.' },
        { who: 'KEEPER', text: 'Four holdings are under two. I could have said so years ago, if anyone had given me the column.' }
      ]
    },

    {
      id: 'b3', act: 2,
      needs: ['pandas'],
      place: 'The Muster Calendar',
      province: 'Karrowmoor',
      teaches: 'date columns · filtering on dates',
      sigil: sigil(S.council),
      keeper: {
        name: 'The Marshal',
        taunt: 'Every muster ever called, in order. Ask me which ones fell in spring and I must recite all of them until spring arrives.'
      },
      story: [
        { who: 'NARRATOR', text: 'The Marshal keeps the calendar — every muster the realm ever called, written as plain text on a strip of vellum a mile long.' },
        { who: 'KEEPER', text: 'The strip is in order. That is the only thing I can promise. To find a season I must walk it.' },
        { who: 'VEX', text: 'Text that looks like a date is not a date. Convert it once and the whole strip becomes something you can cut with a knife.' }
      ],
      fn: 'called_between',
      brief:
        '<p>The calendar arrives with dates stored as <strong>strings</strong> like <code>"2187-04-09"</code>.</p>' +
        '<p><code>called_between(df, start, end)</code> receives a DataFrame with columns ' +
        '<code>muster</code> and <code>called</code> (strings), plus two date strings. Return a frame that:</p>' +
        '<ul>' +
        '<li>converts <code>called</code> to real datetimes,</li>' +
        '<li>keeps only rows where <code>called</code> falls between <code>start</code> and <code>end</code> <strong>inclusive</strong>,</li>' +
        '<li>is sorted by <code>called</code>, earliest first.</li>' +
        '</ul>' +
        '<p>Keep both columns. The <code>called</code> column must come back as datetimes, not strings.</p>',
      bonus: 'let <code>start</code> or <code>end</code> be <code>None</code>, meaning “no bound on that side”.',
      starter:
        'import pandas as pd\n\n' +
        'def called_between(df, start, end):\n' +
        '    out = df.copy()\n' +
        '    # make "called" a real date, then cut the range\n' +
        '    \n',
      tests: [
        {
          label: 'a spring window',
          expr: 'called_between(pd.DataFrame({"muster": ["Tide", "Ember", "Frost"], "called": ["2187-04-09", "2187-07-01", "2187-03-02"]}), "2187-03-01", "2187-05-01")',
          show: 'called_between(3 musters, Mar 1 → May 1)',
          expect_expr: 'pd.DataFrame({"muster": ["Frost", "Tide"], "called": pd.to_datetime(["2187-03-02", "2187-04-09"])})'
        },
        {
          label: 'boundaries count as inside',
          expr: 'len(called_between(pd.DataFrame({"muster": ["A", "B"], "called": ["2200-01-01", "2200-12-31"]}), "2200-01-01", "2200-12-31"))',
          show: 'both endpoint dates are kept',
          expect: 2
        },
        {
          label: 'nothing in the window',
          expr: 'len(called_between(pd.DataFrame({"muster": ["A"], "called": ["2150-06-06"]}), "2200-01-01", "2200-12-31"))',
          show: 'empty window returns no rows',
          expect: 0
        },
        {
          label: 'the column really is datetime',
          expr: 'str(called_between(pd.DataFrame({"muster": ["A"], "called": ["2200-05-05"]}), "2200-01-01", "2200-12-31")["called"].dtype)',
          show: 'dtype of the "called" column',
          expect: 'datetime64[ns]'
        }
      ],
      hints: [
        {
          lore: 'I have called nine thousand musters. I remember the weather at every one. I cannot tell you which were in April.',
          text: '<code>pd.to_datetime(out["called"])</code> turns a column of date strings into real datetimes. Assign it back onto the column.'
        },
        {
          lore: 'A season is not a number to me. It is a place I have to walk to.',
          text: 'Once it is a datetime column you can compare it to plain strings: <code>out["called"] &gt;= start</code>. Combine two conditions with <code>&amp;</code> and wrap each side in parentheses.'
        },
        {
          lore: 'Put them in order for me. Even I would like to see the shape of it.',
          text: '<code>out.sort_values("called")</code> returns a sorted copy. Chain it at the end, after the filter.'
        }
      ],
      solution:
        'import pandas as pd\n\n' +
        'def called_between(df, start, end):\n' +
        '    out = df.copy()\n' +
        '    out["called"] = pd.to_datetime(out["called"])\n' +
        '    mask = (out["called"] >= start) & (out["called"] <= end)\n' +
        '    return out[mask].sort_values("called")\n',
      victory: [
        { who: 'NARRATOR', text: 'The vellum strip folds itself into a calendar — twelve blocks, readable at a glance. The Marshal touches April with something like grief.' },
        { who: 'KEEPER', text: 'Nine thousand musters and I never once saw the year.' }
      ]
    },

    {
      id: 'b4', act: 2,
      needs: ['pandas'],
      place: 'The Twin Bridges',
      province: 'Karrowmoor',
      teaches: 'merge · concat',
      sigil: sigil(S.rings),
      keeper: {
        name: 'The Twinned Sentinel',
        taunt: 'North keeps its roll. South keeps its roll. We have stood here two hundred years and never once compared them.'
      },
      story: [
        { who: 'NARRATOR', text: 'Two bridges, one river. A garrison on each bank, each with its own roll of names, each certain the other is smaller.' },
        { who: 'KEEPER', text: 'We were one sentinel once. The river came through the middle of us. Now there are two rolls and no way to lay them side by side.' },
        { who: 'VEX', text: 'Two shapes of joining, Architect. Stack them on top of each other, or match them up by a shared key. It needs the second one — and it needs to see who is on both rolls.' }
      ],
      fn: 'reconcile',
      brief:
        '<p>Both banks keep a roll. Put them side by side.</p>' +
        '<p><code>reconcile(north, south)</code> receives two DataFrames, each with columns ' +
        '<code>name</code> and <code>spears</code>. Return a frame that:</p>' +
        '<ul>' +
        '<li>joins them on <code>name</code>, keeping <strong>only names that appear on both rolls</strong>,</li>' +
        '<li>has columns <code>name</code>, <code>spears_north</code>, <code>spears_south</code>,</li>' +
        '<li>adds <code>total</code> = the two spear counts summed,</li>' +
        '<li>is sorted by <code>total</code>, largest first.</li>' +
        '</ul>',
      bonus: 'return the names that appear on only <em>one</em> roll, using an outer join and <code>.isna()</code>.',
      starter:
        'import pandas as pd\n\n' +
        'def reconcile(north, south):\n' +
        '    # merge on name, then total them up\n' +
        '    \n',
      tests: [
        {
          label: 'two shared names, one stranger each side',
          expr: 'reconcile(pd.DataFrame({"name": ["Rook", "Vale", "Ash"], "spears": [10, 40, 5]}), pd.DataFrame({"name": ["Vale", "Rook", "Bell"], "spears": [30, 15, 8]}))',
          show: 'reconcile(north 3 names, south 3 names)',
          expect_expr: 'pd.DataFrame({"name": ["Vale", "Rook"], "spears_north": [40, 10], "spears_south": [30, 15], "total": [70, 25]})'
        },
        {
          label: 'no names in common',
          expr: 'len(reconcile(pd.DataFrame({"name": ["A"], "spears": [1]}), pd.DataFrame({"name": ["B"], "spears": [2]})))',
          show: 'rolls with nothing in common',
          expect: 0
        },
        {
          label: 'the suffixed columns exist',
          expr: 'list(reconcile(pd.DataFrame({"name": ["A"], "spears": [1]}), pd.DataFrame({"name": ["A"], "spears": [2]})).columns)',
          show: 'column names on the joined frame',
          expect: ['name', 'spears_north', 'spears_south', 'total']
        }
      ],
      hints: [
        {
          lore: 'We were one sentinel. I remember being able to see both banks at once. I do not remember which half I am.',
          text: '<code>pd.merge(north, south, on="name")</code> matches rows by a shared column. The default is an inner join, which is exactly "only names on both rolls".'
        },
        {
          lore: 'They gave us the same word for two different counts. That is how the confusion started.',
          text: 'Both frames have a column called <code>spears</code>, so merge renames them. Control the names with <code>suffixes=("_north", "_south")</code>.'
        },
        {
          lore: 'Add us together. Just once. I want to know what we were.',
          text: '<code>out["total"] = out["spears_north"] + out["spears_south"]</code>, then <code>out.sort_values("total", ascending=False)</code>.'
        }
      ],
      solution:
        'import pandas as pd\n\n' +
        'def reconcile(north, south):\n' +
        '    out = pd.merge(north, south, on="name", suffixes=("_north", "_south"))\n' +
        '    out["total"] = out["spears_north"] + out["spears_south"]\n' +
        '    return out.sort_values("total", ascending=False)\n',
      victory: [
        { who: 'NARRATOR', text: 'The two rolls lie down beside each other and become one table. Where a name appears twice, the sentinel finally sees a single number.' },
        { who: 'KEEPER', text: 'Twenty-two names on both banks. Twenty-two families who have been paying two tolls to cross their own river.' },
        { who: 'VEX', text: 'The Heartland is yours. Rest tonight. Tomorrow the road goes up, and Orrin is at the top of it.' },
        { who: 'NARRATOR', text: 'End of Act Two.' }
      ]
    },

    /* ============ ACT III — THE OBSIDIAN THRONE ============ */
    {
      id: 'c1', act: 3,
      place: 'The Spider Room',
      province: 'Vaultspire',
      teaches: 'nested data & .get()',
      sigil: sigil(S.eye),
      keeper: {
        name: 'The Archivist',
        taunt: 'It is all in here. All of it. That is precisely the problem.'
      },
      story: [
        { who: 'NARRATOR', text: 'A round room, floor to ceiling with dispatches, connected by threads. The Archivist sits at the centre and has read every one of them.' },
        { who: 'KEEPER', text: 'You want the strong garrisons. I can tell you where every garrison is, what it ate last winter, and the name of the sergeant\'s dog.' },
        { who: 'KEEPER', text: 'What I cannot do is leave anything out. Reach in and take only what you need. I have never been able to.' },
        { who: 'VEX', text: 'Dictionaries inside dictionaries inside lists. Welcome to every real data set you will ever touch.' }
      ],
      fn: 'spy_report',
      brief:
        '<p>A dispatch maps region names to region records, each holding a list of garrisons:</p>' +
        '<pre class="brief-pre">{\n  "north": {"garrisons": [{"name": "Rook", "strength": 140}]},\n  "south": {"garrisons": [{"name": "Vale", "strength": 60}]}\n}</pre>' +
        '<p>Return a <strong>sorted list of the names</strong> of every garrison with <code>strength &gt;= 100</code>, across all regions.</p>' +
        '<p>Some garrisons have no <code>strength</code> recorded. Treat those as <code>0</code> rather than crashing.</p>',
      starter: 'def spy_report(dispatch):\n    strong = []\n    # for each region, walk its garrisons\n    \n    return sorted(strong)\n',
      tests: [
        {
          label: 'One strong, one weak',
          args: [{
            north: { garrisons: [{ name: 'Rook', strength: 140 }] },
            south: { garrisons: [{ name: 'Vale', strength: 60 }] }
          }],
          expect: ['Rook']
        },
        {
          label: 'Several regions',
          args: [{
            north: { garrisons: [{ name: 'Rook', strength: 140 }, { name: 'Ash', strength: 100 }] },
            east: { garrisons: [{ name: 'Bell', strength: 99 }, { name: 'Cairn', strength: 300 }] }
          }],
          expect: ['Ash', 'Cairn', 'Rook']
        },
        {
          label: 'A missing strength field',
          args: [{
            north: { garrisons: [{ name: 'Ghost' }, { name: 'Rook', strength: 200 }] }
          }],
          expect: ['Rook']
        },
        { label: 'Nothing at all', args: [{}], expect: [] }
      ],
      bonus: 'Some regions have no <code>"garrisons"</code> key at all. Make that safe too, with a second <code>.get()</code>.',
      hints: [
        {
          lore: 'I remember the dispatch that warned us. It arrived nine days before the break, correctly, in full.',
          text: 'Two loops, one inside the other. <code>for region in dispatch.values():</code> walks the region records; then <code>for g in region["garrisons"]:</code> walks that region\'s garrisons.'
        },
        {
          lore: 'Nobody read it. It was filed between a grain report and a complaint about a fence. It was not that we ignored it — it was that everything looked the same.',
          text: '<code>g.get("strength", 0)</code> returns the strength, or <code>0</code> when the key is missing. That default is the whole difference between a report and a crash.'
        },
        {
          lore: 'Take the few things that matter. That is the skill I was never given.',
          text: '<code>for region in dispatch.values():</code><br><code>&nbsp;&nbsp;&nbsp;&nbsp;for g in region["garrisons"]:</code><br><code>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;if g.get("strength", 0) >= 100:</code><br><code>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;strong.append(g["name"])</code><br>then <code>return sorted(strong)</code>.'
        }
      ],
      solution:
        'def spy_report(dispatch):\n' +
        '    strong = []\n' +
        '    for region in dispatch.values():\n' +
        '        for g in region.get("garrisons", []):\n' +
        '            if g.get("strength", 0) >= 100:\n' +
        '                strong.append(g["name"])\n' +
        '    return sorted(strong)\n',
      victory: [
        { who: 'KEEPER', text: 'Three names. Out of eleven thousand pages, three names.' },
        { who: 'KEEPER', text: 'I could have done that. Nine days before the break, I could have done that.' },
        { who: 'VEX', text: '...Let it be, Architect. Some seals do not open happily.' }
      ]
    },

    {
      id: 'c2', act: 3,
      place: 'The Cold Forge',
      province: 'Vaultspire',
      teaches: 'classes: __init__, methods, __str__',
      sigil: sigil(S.anvil),
      keeper: {
        name: 'The Smith',
        taunt: 'I can make one. I cannot make a *kind*. Every one I make, I make from nothing, again.'
      },
      story: [
        { who: 'NARRATOR', text: 'The forge is cold, and the floor is covered in legion standards — thousands of them, each one hand-cut, each one slightly different.' },
        { who: 'KEEPER', text: 'Every legion I ever raised, I raised from raw metal, remembering the shape by hand. I was never given a mould.' },
        { who: 'VEX', text: 'It wants a class. A class is the mould: define the shape once, stamp out as many as you like.' }
      ],
      fn: 'Legion',
      brief:
        '<p>Define a class <code>Legion</code>:</p>' +
        '<ul>' +
        '<li><code>Legion(name, size)</code> stores <code>.name</code> and <code>.size</code></li>' +
        '<li><code>.losses(n)</code> reduces <code>.size</code> by <code>n</code>, but never below <code>0</code></li>' +
        '<li><code>str(legion)</code> gives <code>"Iron: 50 strong"</code></li>' +
        '</ul>' +
        '<p>Remember that every method takes <code>self</code> as its first parameter.</p>',
      starter:
        'class Legion:\n' +
        '    def __init__(self, name, size):\n' +
        '        \n' +
        '\n' +
        '    def losses(self, n):\n' +
        '        \n' +
        '\n' +
        '    def __str__(self):\n' +
        '        \n',
      tests: [
        { label: 'It remembers its name', expr: 'Legion("Iron", 50).name', expect: 'Iron' },
        { label: 'It remembers its size', expr: 'Legion("Iron", 50).size', expect: 50 },
        { label: 'It prints properly', expr: 'str(Legion("Iron", 50))', expect: 'Iron: 50 strong' },
        {
          label: 'It takes losses',
          expr: '[(l := Legion("Iron", 50)), l.losses(20), l.size][-1]',
          show: 'l = Legion("Iron", 50); l.losses(20); l.size',
          expect: 30
        },
        {
          label: 'It cannot go below zero',
          expr: '[(l := Legion("Ash", 10)), l.losses(99), l.size][-1]',
          show: 'l = Legion("Ash", 10); l.losses(99); l.size',
          expect: 0
        }
      ],
      bonus: 'Add a <code>.merge(other)</code> method that returns a <em>new</em> Legion combining both names and sizes. Returning a new object instead of mutating is a habit worth building early.',
      hints: [
        {
          lore: 'I forged the standard for the First Legion. Then the Second. Then the Third. I remember each of them individually, because that is the only way I can remember anything.',
          text: '<code>__init__</code> runs when you build one. Store the values on <code>self</code>: <code>self.name = name</code> and <code>self.size = size</code>.'
        },
        {
          lore: 'Do you understand how tiring that is? To have made four hundred legions and to have learned nothing from the first three hundred and ninety-nine?',
          text: 'For <code>losses</code>, subtract and then clamp: <code>self.size = max(0, self.size - n)</code>. <code>max(0, x)</code> is the short way to say "never below zero".'
        },
        {
          lore: 'Give me the mould. Let me make a *kind* of thing, just once.',
          text: '<code>__str__</code> must <strong>return</strong> a string — <code>return f"{self.name}: {self.size} strong"</code>. It is what <code>str()</code> and <code>print()</code> reach for.'
        }
      ],
      solution:
        'class Legion:\n' +
        '    def __init__(self, name, size):\n' +
        '        self.name = name\n' +
        '        self.size = size\n' +
        '\n' +
        '    def losses(self, n):\n' +
        '        self.size = max(0, self.size - n)\n' +
        '\n' +
        '    def __str__(self):\n' +
        '        return f"{self.name}: {self.size} strong"\n',
      victory: [
        { who: 'NARRATOR', text: 'The Smith stamps one standard, then another from the same mould, then twenty in a row without looking down.' },
        { who: 'KEEPER', text: 'The same. All the same. I can make the same thing twice.' }
      ]
    },

    {
      id: 'c3', act: 3,
      place: 'The Broken Ledger',
      province: 'Obsidian Approach',
      teaches: 'try / except',
      sigil: sigil(S.scroll),
      keeper: {
        name: 'The Clerk',
        taunt: 'One bad entry. One. And the whole column is void.'
      },
      story: [
        { who: 'NARRATOR', text: 'A scriptorium at the foot of the mountain. The Clerk holds a ledger with one smudged entry on page four, and has refused to total it for two hundred years.' },
        { who: 'KEEPER', text: 'The rule was that a ledger is either correct or it is not a ledger. One unreadable figure and the whole account is void. That was the rule.' },
        { who: 'VEX', text: 'That rule has cost this province two centuries of accounts. Show it how to survive a bad entry instead of dying on one.' }
      ],
      fn: 'safe_orders',
      brief:
        '<p>The orders arrive as a list of strings. Most are numbers; some are smudged.</p>' +
        '<p>Return a <strong>list of integers</strong> containing only the ones that convert cleanly — skip anything that fails, do not crash.</p>' +
        '<p><code>["10", "smudge", "5"]</code> → <code>[10, 5]</code></p>',
      starter: 'def safe_orders(raw):\n    good = []\n    for item in raw:\n        # try to convert; survive the ones that fail\n        \n    return good\n',
      tests: [
        { label: 'One smudged entry', args: [['10', 'smudge', '5']], expect: [10, 5] },
        { label: 'All unreadable', args: [['x', '', '??']], expect: [] },
        { label: 'All clean', args: [['1', '2', '3']], expect: [1, 2, 3] },
        { label: 'Empty ledger', args: [[]], expect: [] },
        { label: 'Negatives are fine', args: [['-4', 'oops', '9']], expect: [-4, 9] }
      ],
      bonus: 'Return a tuple of <code>(good_values, number_skipped)</code> so the Clerk can note how bad the page was — an error you record is far more useful than one you swallow silently.',
      hints: [
        {
          lore: 'Page four. Third column. A drop of water, two hundred years ago, and I have not been able to close the book since.',
          text: '<code>int("10")</code> gives <code>10</code>. <code>int("smudge")</code> raises a <code>ValueError</code> — that is the thing you are going to catch.'
        },
        {
          lore: 'It was not stubbornness. If I certify a total I am not certain of, and an army marches on it, that is my hand on it.',
          text: 'Wrap just the risky line:<br><code>try:</code><br><code>&nbsp;&nbsp;&nbsp;&nbsp;good.append(int(item))</code><br><code>except ValueError:</code><br><code>&nbsp;&nbsp;&nbsp;&nbsp;continue</code>'
        },
        {
          lore: 'Show me that a book can be mostly true and still be worth having.',
          text: 'Keep the <code>try</code> as small as you can — only the line that can actually fail. Catching <code>ValueError</code> specifically, rather than a bare <code>except:</code>, means a real bug still reaches you instead of hiding in here.'
        }
      ],
      solution:
        'def safe_orders(raw):\n' +
        '    good = []\n' +
        '    for item in raw:\n' +
        '        try:\n' +
        '            good.append(int(item))\n' +
        '        except ValueError:\n' +
        '            continue\n' +
        '    return good\n',
      victory: [
        { who: 'NARRATOR', text: 'The Clerk writes a total at the bottom of the column, and beside it, in smaller letters, "one entry illegible".' },
        { who: 'KEEPER', text: 'It is not a perfect account. But it is an account.' },
        { who: 'VEX', text: 'That is the whole lesson, actually. Up the mountain, Architect. He is waiting.' }
      ]
    },

    {
      id: 'c4', act: 3,
      place: 'The Obsidian Throne',
      province: 'The Summit',
      teaches: 'capstone — filter, sort, format',
      sigil: sigil(S.throne),
      keeper: {
        name: 'Orrin, the Architect Before',
        taunt: 'I ran every future this realm could have. I am not guessing. I am reporting.'
      },
      story: [
        { who: 'NARRATOR', text: 'The Throne room is open to the sky. Orrin has been sitting here since before the break, and he is not a fragment of anything. He is a man.' },
        { who: 'ORRIN', text: 'You have been busy. Four gates, a granary, a council, a forge. I watched you come up the whole coast.' },
        { who: 'ORRIN', text: 'Do you know why I stopped the realm? I computed it. Every branch, every season, every alliance. Eleven million futures, and in every single one, the realm ends badly.' },
        { who: 'ORRIN', text: 'So I halted it here. Nothing decays in a halted realm. Nothing is lost, because nothing happens. I did not fail, Architect. I chose.' },
        { who: 'VEX', text: 'He modelled every future and never once counted the present. Ask him who is standing right now. He has never run that report.' },
        { who: 'ORRIN', text: '...I do not have that number.' }
      ],
      fn: 'campaign',
      brief:
        '<p><strong>The capstone.</strong> Everything from three days, in one function.</p>' +
        '<p>Houses arrive as <code>{"name": "Ferrowmoor", "spears": 120, "loyal": True}</code>.</p>' +
        '<p>Return a <strong>list of strings</strong> — one per <strong>loyal</strong> house, ordered by <strong>spears, highest first</strong> (ties broken by name A→Z), formatted as:</p>' +
        '<p><code>"FERROWMOOR — 120 spears"</code></p>' +
        '<p>The name is uppercased. The dash is an em dash (—), already in your starter code so you need not hunt for it.</p>',
      starter:
        'DASH = "—"\n\n' +
        'def campaign(houses):\n' +
        '    # 1. keep only loyal houses\n' +
        '    # 2. sort by spears desc, then name A-Z\n' +
        '    # 3. format each as  NAME — 120 spears\n' +
        '    \n',
      tests: [
        {
          label: 'A full report',
          args: [[
            { name: 'Ferrowmoor', spears: 120, loyal: true },
            { name: 'Vale', spears: 300, loyal: false },
            { name: 'Kestrel', spears: 45, loyal: true }
          ]],
          expect: ['FERROWMOOR — 120 spears', 'KESTREL — 45 spears']
        },
        {
          label: 'A tie, broken by name',
          args: [[
            { name: 'Vale', spears: 50, loyal: true },
            { name: 'Ashe', spears: 50, loyal: true }
          ]],
          expect: ['ASHE — 50 spears', 'VALE — 50 spears']
        },
        {
          label: 'Nobody loyal',
          args: [[{ name: 'Marrow', spears: 10, loyal: false }]],
          expect: []
        },
        { label: 'Nobody at all', args: [[]], expect: [] },
        {
          label: 'Single house',
          args: [[{ name: 'Ilva', spears: 7, loyal: true }]],
          expect: ['ILVA — 7 spears']
        }
      ],
      bonus: 'Append a final summary line — <code>"TOTAL — 165 spears"</code> — computed from the houses you kept. Then step back and notice you just used every single thing from the last three days in one function.',
      hints: [
        {
          lore: 'I built the models in this room. Eleven million futures. It took nine years.',
          text: 'Do it in three separate steps rather than one clever line. Filter first: <code>loyal = [h for h in houses if h["loyal"]]</code>.'
        },
        {
          lore: 'The worst part was that the models were good. I have checked them since. They were right.',
          text: 'Then sort, exactly as you did at the War Council: <code>sorted(loyal, key=lambda h: (-h["spears"], h["name"]))</code>.'
        },
        {
          lore: 'It never occurred to me to count what was already here. A model of the future is so much more interesting than a list of the living.',
          text: 'Then format with a comprehension:<br><code>return [f"{h[\'name\'].upper()} {DASH} {h[\'spears\']} spears" for h in ranked]</code><br>Watch the quotes — use single quotes inside an f-string that is written with double quotes.'
        }
      ],
      solution:
        'DASH = "—"\n\n' +
        'def campaign(houses):\n' +
        '    loyal = [h for h in houses if h["loyal"]]\n' +
        '    ranked = sorted(loyal, key=lambda h: (-h["spears"], h["name"]))\n' +
        '    return [f"{h[\'name\'].upper()} {DASH} {h[\'spears\']} spears" for h in ranked]\n',
      victory: [
        { who: 'NARRATOR', text: 'The report prints itself down the black wall of the throne room, house by house, in order.' },
        { who: 'ORRIN', text: 'One hundred and sixty-five spears. Forty-one houses. Eleven thousand people.' },
        { who: 'ORRIN', text: 'I have eleven million futures in this room and not one of them has a name in it.' },
        { who: 'VEX', text: 'That was the missing term, Orrin. Not a better model. A shorter one.' },
        { who: 'ORRIN', text: 'Then take it. Take the chair. I would like, very much, to go and see the granary.' }
      ]
    }
  ];

  global.CQ = { ACTS: ACTS, LEVELS: LEVELS };
})(window);
