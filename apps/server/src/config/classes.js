export const gameData = {
    classes: {
      assassin: {
        starterSpells: ['dash', 'backstab', 'poison_dagger', 'kick', 'trap'],
        baseStats: {
          movement: 7,
          energy: 16,
          offense: 7,
          meleeDefense: 3,
          magicDefense: 4,
          hp: 1000
        }
      },
      warrior: {
        starterSpells: ['taunt', 'slash', 'heal', 'rage', 'spin'],
        baseStats: {
          movement: 6,
          energy: 16,
          offense: 8,
          meleeDefense: 6,
          magicDefense: 2,
          hp: 1400
        }
      },
      archer: {
        starterSpells: ['shoot_arrow', 'stun_trap', 'raining_arrows', 'morale_boost', 'push_shot'],
        baseStats: {
          movement: 5,
          energy: 16,
          offense: 6,
          meleeDefense: 4,
          magicDefense: 3,
          hp: 1200
        }
      },
      mage: {
        starterSpells: ['fireball', 'earth_block', 'heal', 'arcane_missile', 'teleportation'],
        baseStats: {
          movement: 5,
          energy: 16,
          offense: 5,
          meleeDefense: 2,
          magicDefense: 7,
          hp: 1200
        }
      }
    }
  };