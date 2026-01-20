export const gameData = {
    classes: {
      assassin: {
        starterSpells: ['dash', 'smoke_trap', 'backstab', 'poison_dagger', 'kick'],
        unlocks: [
          { spellId: 'dodge', level: 5 },
          { spellId: 'shadowstep', level: 8 },
          { spellId: 'invisibility', level: 10 }
        ],
        baseStats: {
          movement: 6,
          energy: 6,
          offense: 7,
          meleeDefense: 3,
          magicDefense: 4,
          hp: 20
        }
      },
      warrior: {
        starterSpells: ['slash', 'cut', 'shield', 'taunt', 'rage'],
        unlocks: [
          { spellId: 'unstoppable', level: 5 },
          { spellId: 'break_walls', level: 8 },
          { spellId: 'spin', level: 10 }
        ],
        baseStats: {
          movement: 4,
          energy: 5,
          offense: 8,
          meleeDefense: 6,
          magicDefense: 2,
          hp: 30
        }
      },
      archer: {
        starterSpells: ['shoot_arrow', 'stun_trap', 'push_shot', 'raining_arrows', 'incapacitating_shot'],
        unlocks: [
          { spellId: 'reveal', level: 5 },
          { spellId: 'morale_boost', level: 8 },
          { spellId: 'rapid_shot', level: 10 }
        ],
        baseStats: {
          movement: 5,
          energy: 6,
          offense: 6,
          meleeDefense: 4,
          magicDefense: 3,
          hp: 22
        }
      },
      mage: {
        starterSpells: ['fireball', 'earth_wall', 'heal', 'arcane_explosion', 'entangle'],
        unlocks: [
          { spellId: 'teleportation', level: 5 },
          { spellId: 'shield', level: 8 },
          { spellId: 'ice_spikes', level: 10 }
        ],
        baseStats: {
          movement: 3,
          energy: 7,
          offense: 5,
          meleeDefense: 2,
          magicDefense: 7,
          hp: 18
        }
      }
    }
  };